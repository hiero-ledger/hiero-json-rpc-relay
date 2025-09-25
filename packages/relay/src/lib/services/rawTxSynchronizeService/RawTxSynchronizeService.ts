// SPDX-License-Identifier: Apache-2.0

import { Mutex, withTimeout } from 'async-mutex';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

export class RawTxSynchronizeService {
  /** Default timeout for lock acquisition in milliseconds (30 seconds) */
  private static readonly DEFAULT_LOCK_TIMEOUT_MS = 30_000;

  /** Default TTL for inactive sender mutex entries in milliseconds (15 minutes) */
  private static readonly DEFAULT_LOCK_STATE_TTL_MS = 15 * 60 * 1000;

  /** Maximum number of sender mutex entries to maintain concurrently */
  private static readonly MAX_LOCKS = 1000;

  /** LRU cache with TTL for managing sender mutexes with automatic cleanup */
  private readonly localLockStates: LRUCache<string, Mutex>;

  /** Logger instance for debugging and monitoring lock operations */
  private readonly logger: Logger;

  /**
   * Creates a new RawTxSynchronizeService instance.
   *
   * Initializes the LRU cache with TTL for automatic cleanup of inactive sender mutexes.
   * The cache prevents memory leaks through both time-based (TTL) and size-based (LRU) eviction.
   *
   * @param logger - Logger instance for debugging and monitoring lock operations
   */
  constructor(logger: Logger) {
    this.logger = logger;
    this.localLockStates = new LRUCache<string, Mutex>({
      max: RawTxSynchronizeService.MAX_LOCKS,
      ttl: RawTxSynchronizeService.DEFAULT_LOCK_STATE_TTL_MS,
      dispose: (mutex: Mutex, sender: string) => {
        // Clean up any active locks during eviction/expiration
        if (mutex.isLocked()) {
          try {
            mutex.release();
            this.logger.debug(`Active lock auto-released during cleanup for sender: ${sender}`);
          } catch (error) {
            this.logger.warn(`Error auto-releasing lock during cleanup for sender: ${sender}`, error);
          }
        }
        this.logger.debug(`Lock state evicted/expired for sender: ${sender}`);
      },
    });
  }

  /**
   * Acquires a mutex lock for the specified sender address with timeout.
   *
   * This method implements timeout-based lock acquisition. The call will wait for the mutex
   * to become available but will timeout after the configured duration to prevent
   * deadlocks and ensure resource availability.
   *
   * @param sender - The sender address (wallet address) to acquire the lock for
   * @returns Promise that resolves when the lock is successfully acquired
   * @throws Error if the lock acquisition fails due to timeout or internal errors
   */
  async acquireLock(sender: string): Promise<void> {
    const mutex = this.getOrCreateMutex(sender);
    const timeoutMutex = withTimeout(mutex, RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS);

    try {
      // Acquire the mutex lock with timeout protection
      await timeoutMutex.acquire();
      this.logger.debug(
        `Lock acquired for sender: ${sender}, timeout: ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(
          `Failed to acquire lock for sender ${sender}: timeout after ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms`,
        );
      }
      this.logger.error(`Failed to acquire lock for ${sender}:`, error);
      throw error;
    }
  }

  /**
   * Releases the mutex lock for the specified sender address.
   *
   * This method safely releases a previously acquired lock using the mutex instance and performs cleanup
   * to prevent resource leaks. It's safe to call even if no lock is held for the sender.
   *
   * @param sender - The sender address to release the lock for
   * @returns Promise that resolves when the lock is successfully released
   */
  async releaseLock(sender: string): Promise<void> {
    const mutex = this.localLockStates.get(sender);
    if (!mutex || !mutex.isLocked()) {
      this.logger.debug(`No active lock to release for sender: ${sender}`);
      return;
    }

    try {
      mutex.release();
      this.logger.debug(`Lock released for sender: ${sender}`);
    } catch (error) {
      this.logger.error(`Error releasing lock for ${sender}:`, error);
    }
  }

  /**
   * Retrieves an existing mutex for the sender or creates a new one if needed.
   *
   * @private
   * @param sender - The sender address to get or create a mutex for
   * @returns The mutex associated with the specified sender
   */
  private getOrCreateMutex(sender: string): Mutex {
    let mutex = this.localLockStates.get(sender);
    if (!mutex) {
      mutex = new Mutex();
      this.localLockStates.set(sender, mutex);
    }
    return mutex;
  }
}
