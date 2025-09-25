// SPDX-License-Identifier: Apache-2.0

import { Mutex, withTimeout } from 'async-mutex';
import { Transaction } from 'ethers';
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
   * Executes a callback under an exclusive per-sender mutex with timeout protection.
   *
   * The lock is automatically released once the callback settles (resolve or reject). If the lock cannot be
   * acquired within the configured timeout, an error is thrown mirroring the previous behaviour.
   *
   * @param rawTransaction - The raw transaction payload used to derive the sender address
   * @param callback - The critical section to execute while the sender lock is held
   * @returns The callback result
   */
  async runExclusive<T>(rawTransaction: string, callback: () => Promise<T> | T): Promise<T> {
    const senderAddress = this.extractSender(rawTransaction);

    if (!senderAddress) {
      this.logger.warn('Unable to derive sender from raw transaction. Executing callback without synchronization.');
      return await callback();
    }

    const mutex = this.getOrCreateMutex(senderAddress);
    const timeoutMutex = withTimeout(mutex, RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS);
    const waitStartedAt = Date.now();
    let lockAcquired = false;

    try {
      return await timeoutMutex.runExclusive(async () => {
        const waitDurationMs = Date.now() - waitStartedAt;
        this.logger.debug(
          `Lock acquired for sender: ${senderAddress}, waited ${waitDurationMs}ms (timeout: ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms)`,
        );
        lockAcquired = true;

        return await callback();
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(
          `Failed to acquire lock for sender ${senderAddress}: timeout after ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms`,
        );
      }

      this.logger.error(`Failed to execute exclusive section for ${senderAddress}:`, error);
      throw error;
    } finally {
      // only log release event if lock was actually acquired
      if (lockAcquired) {
        this.logger.debug(`Lock released for sender: ${senderAddress}`);
      }
    }
  } /**
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

  /**
   * Parses the raw transaction and returns the normalized sender address if available.
   *
   * @param rawTransaction - The serialized transaction payload (with or without 0x prefix)
   * @returns The lowercase sender address, or null when parsing fails or sender is absent
   */
  private extractSender(rawTransaction: string): string | null | undefined {
    try {
      return Transaction.from(rawTransaction).from?.toLowerCase();
    } catch {
      return null;
    }
  }
}
