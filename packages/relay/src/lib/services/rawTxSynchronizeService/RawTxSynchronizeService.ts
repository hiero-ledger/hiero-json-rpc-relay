// SPDX-License-Identifier: Apache-2.0

import { Mutex, withTimeout } from 'async-mutex';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

interface LocalLockState {
  /** The mutex instance used for synchronization */
  mutex: Mutex;
  /** The release function returned by mutex.acquire(), present only when lock is held */
  release?: () => void;
}

export class RawTxSynchronizeService {
  /** Default timeout for lock acquisition in milliseconds (30 seconds) */
  private static readonly DEFAULT_LOCK_TIMEOUT_MS = 30_000;

  /** Default TTL for inactive lock states in milliseconds (15 minutes) */
  private static readonly DEFAULT_LOCK_STATE_TTL_MS = 15 * 60 * 1000;

  /** Maximum number of concurrent sender lock states to maintain */
  private static readonly MAX_LOCKS = 1000;

  /** LRU cache with TTL for managing lock states with automatic cleanup */
  private readonly localLockStates: LRUCache<string, LocalLockState>;

  /** Logger instance for debugging and monitoring lock operations */
  private readonly logger: Logger;

  /**
   * Creates a new RawTxSynchronizeService instance.
   *
   * Initializes the LRU cache with TTL for automatic cleanup of inactive lock states.
   * The cache prevents memory leaks through both time-based (TTL) and size-based (LRU) eviction.
   *
   * @param logger - Logger instance for debugging and monitoring lock operations
   */
  constructor(logger: Logger) {
    this.logger = logger;
    this.localLockStates = new LRUCache<string, LocalLockState>({
      max: RawTxSynchronizeService.MAX_LOCKS,
      ttl: RawTxSynchronizeService.DEFAULT_LOCK_STATE_TTL_MS,
      dispose: (lockState: LocalLockState, sender: string) => {
        // Clean up any active locks during eviction/expiration
        if (lockState.release) {
          try {
            lockState.release();
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
    const localLockState = this.getOrCreateLockState(sender);
    const timeoutMutex = withTimeout(localLockState.mutex, RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS);

    try {
      // Acquire the mutex lock with timeout protection
      const release = await timeoutMutex.acquire();
      localLockState.release = release;
      this.logger.debug(
        `Lock acquired for sender: ${sender}, timeout: ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        this.logger.warn(
          `Lock acquisition timeout for sender: ${sender} after ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms`,
        );
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
   * This method safely releases a previously acquired lock and performs cleanup
   * to prevent resource leaks. It's safe to call even if no lock is held for the sender.
   *
   * @param sender - The sender address to release the lock for
   * @returns Promise that resolves when the lock is successfully released
   */
  async releaseLock(sender: string): Promise<void> {
    const localLockState = this.localLockStates.get(sender);
    if (!localLockState?.release) {
      this.logger.debug(`No active lock to release for sender: ${sender}`);
      return;
    }

    try {
      localLockState.release(); // Execute the stored release function
      localLockState.release = undefined; // Clear the release function but keep the mutex
      this.logger.debug(`Lock released for sender: ${sender}`);
    } catch (error) {
      this.logger.error(`Error releasing lock for ${sender}:`, error);
      // Even if release fails, clear the release function to prevent inconsistent state
      localLockState.release = undefined;
    }
  }

  /**
   * Retrieves an existing lock state for the sender or creates a new one if needed.
   *
   * This method implements lazy initialization of lock states using LRU cache with TTL.
   * Lock states are created only when first needed and are automatically cleaned up
   * after periods of inactivity or when the cache reaches capacity limits.
   *
   * @private
   * @param sender - The sender address to get or create a lock state for
   * @returns The lock state for the specified sender
   */
  private getOrCreateLockState(sender: string): LocalLockState {
    let lockState = this.localLockStates.get(sender);
    if (!lockState) {
      lockState = {
        mutex: new Mutex(),
        release: undefined,
      };
      this.localLockStates.set(sender, lockState);
      this.logger.debug(`Created new lock state for sender: ${sender}`);
    } else {
      this.logger.debug(`Reusing existing lock state for sender: ${sender}`);
    }
    return lockState;
  }
}
