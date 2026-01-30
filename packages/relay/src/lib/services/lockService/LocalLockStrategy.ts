// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Mutex } from 'async-mutex';
import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

import { LockStrategy } from '../../types/lock';
import { LockMetricsService } from './LockMetricsService';
import { LockService } from './LockService';

/**
 * Represents the internal state for a lock associated with a given address.
 */
export interface LockState {
  mutex: Mutex;
  sessionKey: string | null;
  acquiredAt: number | null;
  lockTimeoutId: NodeJS.Timeout | null;
}

/**
 * Implements a local, in-memory locking strategy.
 *
 * Each unique "address" gets its own mutex to ensure only one session can hold
 * the lock at a time. Locks are auto-expiring and stored in an LRU cache.
 */
export class LocalLockStrategy implements LockStrategy {
  /**
   * LRU cache of lock states, keyed by address.
   */
  private localLockStates = new LRUCache<string, LockState>({
    max: ConfigService.get('LOCAL_LOCK_MAX_ENTRIES'),
  });

  /**
   * Logger.
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * Metrics service for recording lock-related metrics.
   *
   * @private
   */
  private readonly lockMetricsService: LockMetricsService;

  /**
   * Creates a new LocalLockStrategy instance.
   *
   * @param logger - The logger
   * @param lockMetricsService - The metrics service for recording lock metrics
   */
  constructor(logger: Logger, lockMetricsService: LockMetricsService) {
    this.logger = logger;
    this.lockMetricsService = lockMetricsService;
  }

  /**
   * Acquire a lock for a specific address.
   * Waits until the lock is available (blocking if another session holds it).
   *
   * @param address - The key representing the resource to lock
   * @returns A session key identifying the current lock owner
   */
  async acquireLock(address: string): Promise<string | undefined> {
    const sessionKey = randomUUID();
    const startTime = Date.now();

    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(`Acquiring lock for address ${address} and sessionkey ${sessionKey}.`);
    }
    const state = this.getOrCreateState(address);

    this.lockMetricsService.incrementWaitingTxns('local');

    try {
      // Acquire the mutex (this will block until available)
      await state.mutex.acquire();

      // Record wait time
      const waitTimeSeconds = (Date.now() - startTime) / 1000;
      this.lockMetricsService.recordWaitTime('local', waitTimeSeconds);

      // Record lock ownership metadata
      state.sessionKey = sessionKey;
      state.acquiredAt = Date.now();

      // Start a 30-second timer to auto-release if lock not manually released
      state.lockTimeoutId = setTimeout(() => {
        this.forceReleaseExpiredLock(address, sessionKey);
      }, ConfigService.get('LOCK_MAX_HOLD_MS'));

      // Record successful acquisition
      this.lockMetricsService.recordAcquisition('local', 'success');
      this.lockMetricsService.incrementActiveCount('local');

      return sessionKey;
    } catch (error) {
      this.lockMetricsService.recordAcquisition('local', 'fail');
      throw error;
    } finally {
      this.lockMetricsService.decrementWaitingTxns('local');
    }
  }

  /**
   * Release a previously acquired lock, if the session key matches the current owner.
   *
   * @param address - The locked resource key
   * @param sessionKey - The session key of the lock holder
   */
  async releaseLock(address: string, sessionKey: string): Promise<void> {
    const normalizedAddress = LockService.normalizeAddress(address);
    const state = this.localLockStates.get(normalizedAddress);
    if (state) {
      // Ensure only the lock owner can release
      if (state.sessionKey === sessionKey) {
        const holdTime = Date.now() - state.acquiredAt!;

        await this.doRelease(state);

        this.lockMetricsService.recordHoldDuration('local', holdTime / 1000);
        this.lockMetricsService.decrementActiveCount('local');

        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(
            `Releasing lock for address ${address} and session key ${sessionKey} held for ${holdTime}ms.`,
          );
        }
      }
    }
  }

  /**
   * Retrieve an existing lock state for the given address, or create a new one if it doesn't exist.
   *
   * @param address - Unique identifier for the lock
   * @returns The LockState object associated with the address
   */
  private getOrCreateState(address: string): LockState {
    const normalizedAddress = LockService.normalizeAddress(address);
    if (!this.localLockStates.has(normalizedAddress)) {
      this.localLockStates.set(normalizedAddress, {
        mutex: new Mutex(),
        sessionKey: null,
        acquiredAt: null,
        lockTimeoutId: null,
      });
    }

    return this.localLockStates.get(normalizedAddress)!;
  }

  /**
   * Internal helper to perform cleanup and release the mutex.
   *
   * @param state - The LockState instance to reset and release
   */
  private async doRelease(state: LockState): Promise<void> {
    // Clear timeout first
    clearTimeout(state.lockTimeoutId!);

    // Reset state
    state.sessionKey = null;
    state.lockTimeoutId = null;
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
    const normalizedAddress = LockService.normalizeAddress(address);
    const state = this.localLockStates.get(normalizedAddress);

    if (state?.sessionKey === sessionKey) {
      const holdTimeMs = Date.now() - state.acquiredAt!;

      await this.doRelease(state);

      // Record metrics for timeout release
      this.lockMetricsService.recordHoldDuration('local', holdTimeMs / 1000);
      this.lockMetricsService.recordTimeoutRelease('local');
      this.lockMetricsService.decrementActiveCount('local');

      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(`Force releasing expired local lock for address ${address} held for ${holdTimeMs}ms.`);
      }
    }
  }
}
