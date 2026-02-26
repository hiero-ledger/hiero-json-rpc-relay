// SPDX-License-Identifier: Apache-2.0

import { LRUCache } from 'lru-cache';

import { RateLimitKey, RateLimitStore } from '../../types';

/**
 * Per-method request counter held within a single IP rate-limit entry.
 * @internal
 */
interface MethodEntry {
  /** Allowed requests remaining in the current time window. */
  remaining: number;
  /**
   * Maximum allowed requests per window; updated when the `limit` argument
   * changes at window-reset time to honour dynamic limit adjustments.
   */
  total: number;
}

/**
 * Per-IP rate-limit record stored in the bounded LRU cache.
 * @internal
 */
interface IpEntry {
  /** Epoch (ms) at which the current rate-limit window resets. */
  reset: number;
  /** Per-method counters, keyed by RPC method name. */
  methods: Record<string, MethodEntry>;
}

/**
 * Upper bound on the number of distinct IP addresses held in memory at any
 * one time.  Oldest-accessed IPs are evicted silently once this ceiling is
 * reached, giving them a fresh (fully-allowed) budget on their next request —
 * an acceptable trade-off that prevents unbounded memory growth under
 * high-cardinality IP sets.
 */
const MAX_IP_ENTRIES = 500;

/**
 * A bounded, TTL-aware in-memory rate-limit store backed by an LRU cache.
 *
 * Each IP address occupies one cache slot containing per-method request
 * counters.  Entries are reclaimed in two independent ways:
 *
 * 1. **TTL eviction** — an entry is removed after `duration` ms of inactivity,
 *    freeing memory for IPs that have stopped sending requests.
 * 2. **LRU eviction** — when {@link MAX_IP_ENTRIES} is reached, the
 *    least-recently-used IP is silently dropped; on its next request it simply
 *    receives a fresh, fully-allowed budget.
 *
 * This replaces the previous `Object.create(null)` map that accumulated
 * one entry per unique IP for the entire process lifetime (unbounded leak).
 *
 * @implements {RateLimitStore}
 */
export class LruRateLimitStore implements RateLimitStore {
  /** Duration of each rate-limit window in milliseconds. */
  private readonly duration: number;

  /** Bounded LRU cache mapping IP address → per-window rate-limit entry. */
  private readonly cache: LRUCache<string, IpEntry>;

  /**
   * Creates a new `LruRateLimitStore`.
   *
   * @param duration - Length of each rate-limit window in milliseconds.
   */
  constructor(duration: number) {
    this.duration = duration;
    this.cache = new LRUCache<string, IpEntry>({
      max: MAX_IP_ENTRIES,
      // Evict IP entries that have been idle for a full duration window so memory
      // is reclaimed promptly for IPs that stop sending requests.  Each call to
      // cache.get() automatically refreshes the TTL, keeping active IPs alive.
      ttl: duration,
      ttlAutopurge: true,
    });
  }

  /**
   * Atomically increments the request count for the given IP + method pair
   * and reports whether the rate limit has been exceeded.
   *
   * Time complexity: O(1) amortised (LRU get/set with hash-map backing).
   *
   * @param key - Composite key containing the caller's IP address and RPC
   *   method name.
   * @param limit - Maximum number of requests allowed within a single window.
   * @returns `true` if the limit is exceeded (request should be rejected);
   *   `false` if the request is within budget.
   */
  async incrementAndCheck(key: RateLimitKey, limit: number): Promise<boolean> {
    const { ip, method } = key;
    const now = Date.now();

    // Retrieve existing entry; cache.get also refreshes LRU position + TTL so
    // active IPs are never prematurely evicted.
    let entry = this.cache.get(ip);

    if (!entry) {
      // First request ever seen from this IP: open a fresh window.
      entry = { reset: now + this.duration, methods: {} };
    } else if (now >= entry.reset) {
      // The current window has expired: advance the window start and restore
      // all per-method budgets to their recorded totals.
      entry.reset = now + this.duration;
      for (const m of Object.values(entry.methods)) {
        m.remaining = m.total;
      }
      // Honour any limit change for the current method at window-reset time.
      if (entry.methods[method]) {
        entry.methods[method].remaining = limit;
        entry.methods[method].total = limit;
      }
    }

    // Initialise the method slot on first use within this IP scope.
    if (!entry.methods[method]) {
      entry.methods[method] = { remaining: limit, total: limit };
    }

    // Write back to cache — creates or refreshes the LRU position and TTL.
    this.cache.set(ip, entry);

    // Consume one request token; deny if the budget is exhausted.
    if (entry.methods[method].remaining > 0) {
      entry.methods[method].remaining--;
      return false;
    }
    return true;
  }
}
