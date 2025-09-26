// SPDX-License-Identifier: Apache-2.0

import { Mutex, withTimeout } from 'async-mutex';
import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

/**
 * Represents the state of a lock for a specific sender address.
 * Encapsulates both the mutex and the active session keys for that lock.
 */
interface LockState {
  /** The mutex used for synchronization */
  mutex: Mutex;
  /** Set of active session keys that can release this lock */
  activeSessionKeys: Set<string>;
}

export class RawTxSynchronizeService {
  /** Default timeout for lock acquisition in milliseconds (300 seconds) */
  private static readonly DEFAULT_LOCK_TIMEOUT_MS = 300_000;

  /** Default TTL for inactive sender mutex entries in milliseconds (15 minutes) */
  private static readonly DEFAULT_LOCK_STATE_TTL_MS = 15 * 60 * 1000;

  /** Maximum number of sender mutex entries to maintain concurrently */
  private static readonly MAX_LOCKS = 1000;

  /** LRU cache with TTL for managing sender lock states with automatic cleanup */
  private readonly localLockStates: LRUCache<string, LockState>;

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
    this.localLockStates = new LRUCache<string, LockState>({
      max: RawTxSynchronizeService.MAX_LOCKS,
      ttl: RawTxSynchronizeService.DEFAULT_LOCK_STATE_TTL_MS,
      dispose: (lockState: LockState, sender: string) => {
        // Clean up any active locks during eviction/expiration
        if (lockState.mutex.isLocked()) {
          try {
            lockState.mutex.release();
            this.logger.debug(`Active lock auto-released during cleanup for sender: ${sender}`);
          } catch (error) {
            this.logger.warn(`Error auto-releasing lock during cleanup for sender: ${sender}`, error);
          }
        }
        // Clear all active sessions since the lock state is being disposed
        lockState.activeSessionKeys.clear();
        this.logger.debug(`Lock state evicted/expired for sender: ${sender}`);
      },
    });
  }

  /**
   * Acquires a mutex lock for the specified sender address with timeout.
   *
   * This method implements timeout-based lock acquisition and generates a unique session key
   * to track the lock instance. The session key can be used to release the specific lock
   * and prevent double-release scenarios.
   *
   * @param sender - The sender address (wallet address) to acquire the lock for
   * @returns Promise that resolves to a unique session key when the lock is successfully acquired
   * @throws Error if the lock acquisition fails due to timeout or internal errors
   */
  async acquireLock(sender: string): Promise<string> {
    const lockState = this.getOrCreateLockState(sender);
    const timeoutMutex = withTimeout(lockState.mutex, RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS);
    const waitStartedAt = Date.now();
    const sessionKey = randomUUID();

    try {
      // Acquire the mutex lock with timeout protection
      await timeoutMutex.acquire();

      // Add the session key to the active sessions set
      lockState.activeSessionKeys.add(sessionKey);

      const waitDurationMs = Date.now() - waitStartedAt;
      this.logger.debug(
        `Lock acquired for sender: ${sender}, sessionKey: ${sessionKey}, waited ${waitDurationMs}ms (timeout: ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms)`,
      );
      return sessionKey;
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
   * Releases the mutex lock for the specified sender address using a session key.
   *
   * This method safely releases a previously acquired lock by checking if the session key
   * is in the active sessions set. If the session key exists, it releases the mutex and
   * removes the session key. If not, it means the lock for that session was already released (double-release protection).
   *
   * @param sender - The sender address to release the lock for
   * @param sessionKey - The unique session key returned from acquireLock()
   * @returns Promise that resolves when the lock is successfully released or if already released
   */
  async releaseLock(sender: string, sessionKey: string): Promise<void> {
    const lockState = this.localLockStates.get(sender);

    if (!lockState || !lockState.activeSessionKeys.has(sessionKey)) {
      this.logger.debug(`Lock already released or not found for sender: ${sender}, session: ${sessionKey}`);
      return;
    }

    try {
      lockState.mutex.release();
      this.logger.debug(`Lock released for sender: ${sender}, session: ${sessionKey}`);
    } catch (error) {
      this.logger.error(`Error releasing lock for ${sender}, session: ${sessionKey}:`, error);
    } finally {
      // Always remove the session key to prevent stale state, regardless of success or error
      lockState.activeSessionKeys.delete(sessionKey);
    }
  }
  /**
   * Retrieves an existing lock state for the sender or creates a new one if needed.
   *
   * @private
   * @param sender - The sender address to get or create a lock state for
   * @returns The lock state associated with the specified sender
   */
  private getOrCreateLockState(sender: string): LockState {
    let lockState = this.localLockStates.get(sender);
    if (!lockState) {
      lockState = {
        mutex: new Mutex(),
        activeSessionKeys: new Set<string>(),
      };
      this.localLockStates.set(sender, lockState);
    }
    return lockState;
  }
}
