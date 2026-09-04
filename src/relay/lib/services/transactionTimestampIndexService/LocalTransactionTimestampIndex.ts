// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { Registry } from 'prom-client';

import { LocalLRUCache } from '../../clients/cache/localLRUCache';
import constants from '../../constants';
import { type ITransactionTimestampIndex } from '../../types/ITransactionTimestampIndex';

/**
 * Local in-memory implementation of {@link ITransactionTimestampIndex}, backed by its own
 * {@link LocalLRUCache}.
 *
 * The cache is bounded by `TX_TIMESTAMP_INDEX_MAX_ENTRIES` rather than the shared `CACHE_MAX`, so a busy
 * block cannot evict live block, balance and gas price data. Overflow is harmless: a dropped entry costs a
 * fallback, never correctness.
 */
export class LocalTransactionTimestampIndex implements ITransactionTimestampIndex {
  private readonly cache: LocalLRUCache;

  /** Per-entry TTL in milliseconds (`0`/`-1` = eternal). */
  private readonly ttlMs: number;

  /**
   * @param logger - Logger passed through to the internal cache.
   * @param ttlMs - Per-entry TTL in milliseconds (`0`/`-1` = eternal).
   * @param maxEntries - Upper bound on retained entries.
   */
  constructor(logger: Logger, ttlMs: number, maxEntries: number) {
    this.ttlMs = ttlMs;
    this.cache = new LocalLRUCache(
      logger.child({ name: 'tx-timestamp-index-cache' }),
      new Registry(),
      undefined,
      maxEntries,
    );
  }

  /** TTL as {@link LocalLRUCache.set} expects it: a positive ms value, or `0` for indefinite retention. */
  private resolveTtl(): number {
    return this.ttlMs > 0 ? this.ttlMs : 0;
  }

  private hashKey(hash: string): string {
    return `${constants.TX_TIMESTAMP_INDEX_KEY_PREFIX}${hash}`;
  }

  async setMany(entries: ReadonlyArray<readonly [string, string]>): Promise<void> {
    for (const [hash, consensusTimestamp] of entries) {
      await this.cache.set(this.hashKey(hash), consensusTimestamp, this.setMany.name, this.resolveTtl());
    }
  }

  async get(hash: string): Promise<string | null> {
    return (await this.cache.get(this.hashKey(hash), this.get.name)) ?? null;
  }
}
