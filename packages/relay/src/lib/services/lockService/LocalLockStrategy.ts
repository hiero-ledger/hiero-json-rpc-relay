// SPDX-License-Identifier: Apache-2.0

import { Mutex } from 'async-mutex';
import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

import { LockStrategy } from '../../types';

/**
 * Represents the internal state for a lock associated with a given address.
 */
interface LockState {
  mutex: Mutex;
  sessionKey: string | null;
  acquiredAt: number | null;
  maxLockTime: NodeJS.Timeout | null;
}

/**
 * Implements a local, in-memory locking strategy.
 *
 * Each unique "address" gets its own mutex to ensure only one session can hold
 * the lock at a time. Locks are auto-expiring and stored in an LRU cache.
 */
export class LocalLockStrategy {
  /**
   * Maximum number of lock entries stored in memory.
   * Prevents unbounded memory growth.
   */
  public static LOCAL_LOCK_MAX_ENTRIES: number = 1_000; // Max 1000 addresses

  /**
   * Time-to-live for each lock entry in the cache (in milliseconds).
   */
  public static LOCAL_LOCK_TTL: number = 300_000; // 5 minutes

  /**
   * Seconds for auto-release if lock not manually released
   */
  public static LOCAL_LOCK_MAX_LOCK_TIME: number = 30_000; // 60 secs

  /**
   * LRU cache of lock states, keyed by address.
   */
  private localLockStates = new LRUCache<string, LockState>({
    max: LocalLockStrategy.LOCAL_LOCK_MAX_ENTRIES,
    ttl: LocalLockStrategy.LOCAL_LOCK_TTL,
  });

  /**
   * Logger
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * Creates a new LocalLockStrategy instance.
   *
   * @param logger - The logger
   */
  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Acquire a lock for a specific address.
   * Waits until the lock is available (blocking if another session holds it).
   *
   * @param address - The key representing the resource to lock
   * @returns A session key identifying the current lock owner
   */
  async acquireLock(address: string): Promise<string> {
    const sessionKey = randomUUID();
    const state = this.getOrCreateState(address);

    // Acquire the mutex (this will block until available)
    await state.mutex.acquire();

    // Record lock ownership metadata
    state.sessionKey = sessionKey;
    state.acquiredAt = Date.now();

    // Start a 30-second timer to auto-release if lock not manually released
    state.maxLockTime = setTimeout(() => {
      this.forceReleaseExpiredLock(address, sessionKey);
    }, LocalLockStrategy.LOCAL_LOCK_MAX_LOCK_TIME);

    return sessionKey;
  }

  /**
   * Release a previously acquired lock, if the session key matches the current owner.
   *
   * @param address - The locked resource key
   * @param sessionKey - The session key of the lock holder
   */
  async releaseLock(address: string, sessionKey: string): Promise<void> {
    const state = this.localLockStates.get(address);

    // Ensure only the lock owner can release
    if (state?.sessionKey !== sessionKey) {
      return; // Not the owner — safely ignore
    }

    // Perform cleanup and release
    await this.doRelease(state);
  }

  /**
   * Retrieve an existing lock state for the given address, or create a new one if it doesn't exist.
   *
   * @param address - Unique identifier for the lock
   * @returns The LockState object associated with the address
   */
  private getOrCreateState(address: string): LockState {
    if (!this.localLockStates.has(address)) {
      this.localLockStates.set(address, {
        mutex: new Mutex(),
        sessionKey: null,
        acquiredAt: null,
        maxLockTime: null,
      });
    }

    return this.localLockStates.get(address)!;
  }

  /**
   * Internal helper to perform cleanup and release the mutex.
   *
   * @param state - The LockState instance to reset and release
   */
  private async doRelease(state: LockState): Promise<void> {
    // Clear timeout first
    clearTimeout(state.maxLockTime!);

    // Reset state
    state.sessionKey = null;
    state.maxLockTime = null;
    state.acquiredAt = null;

    // Release the mutex lock
    state.mutex.release();
  }

  /**
   * Forcefully release a lock that has exceeded its maximum execution time.
   * Used by the timeout set during `acquireLock`.
   *
   * @param address - The resource key associated with the lock
   * @param sessionKey - The session key to verify ownership before releasing
   */
  private async forceReleaseExpiredLock(address: string, sessionKey: string): Promise<void> {
    const state = this.localLockStates.get(address);

    // Ensure the session still owns the lock before force-releasing
    if (!state || state.sessionKey !== sessionKey) {
      return; // Already released or lock reassigned
    }

    if (this.logger.isLevelEnabled('debug')) {
      const holdTime = Date.now() - state.acquiredAt!;
      this.logger.debug(`Force releasing expired local lock for address ${address} held for ${holdTime}ms.`);
    }

    await this.doRelease(state);
  }
}
