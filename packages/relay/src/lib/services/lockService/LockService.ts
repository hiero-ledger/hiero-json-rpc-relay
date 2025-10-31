// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

import { TransactionPoolService } from '../../types/transactionPool';

export class LockService {
  /**
   * Maximum time in milliseconds to wait for lock acquisition before timing out.
   */
  private readonly lockAcquisitionTimeoutMs = 900000;

  /**
   * Maximum duration in milliseconds that a lock can exist before automatic expiration.
   */
  private readonly lockTtlMs = 9000000;

  /**
   * Polling interval in milliseconds for checking queue position during lock acquisition.
   */
  private readonly acquisitionPollIntervalMs = 50;

  /**
   * LRU cache configuration for lock storage.
   *
   * - ttl: Locks auto-expire after lockTtlMs to prevent deadlocks
   * - ttlAutopurge: true ensures expired locks are removed automatically to prevent memory leaks from lock accumulation
   */
  private readonly lockLruCacheOptions = {
    ttl: this.lockTtlMs,
    ttlAutopurge: true,
  } as const;

  /**
   * LRU cache mapping lock keys to current holder's session key.
   */
  private readonly lockStorage: LRUCache<string, string>;

  /**
   * Plain Map mapping lock keys to FIFO arrays of waiting session keys.
   * Queues are coordination metadata with no TTL - they exist as long as
   * transactions are queued, and are deleted deterministically when empty.
   */
  private readonly sessionQueues: Map<string, string[]>;

  /**
   * Creates a new LocalLockStrategy instance.
   *
   * @param logger - Logger instance for debugging and monitoring
   */
  constructor(
    private readonly logger: Logger,
    private readonly transactionPoolService: TransactionPoolService,
  ) {
    this.lockStorage = new LRUCache<string, string>(this.lockLruCacheOptions);
    this.sessionQueues = new Map<string, string[]>();
    this.logger.info(
      `Local lock strategy initialized: lockAcquisitionTimeoutMs=${this.lockAcquisitionTimeoutMs}ms, lockTtlMs=${this.lockTtlMs}ms, acquisitionPollIntervalMs=${this.acquisitionPollIntervalMs}ms`,
    );
  }

  /**
   * Acquires a local lock for the specified resource.
   *
   * @param lockId - The unique identifier for the resource to lock.
   * @returns A promise that resolves to the session key if the lock is successfully acquired, or null if error occurs.
   */
  // async acquireLock(lockId: string, rlpHex: string): Promise<string | null> {
  async acquireLock(lockId: string, rlpHex: string): Promise<void> {
    const lockKey = this.buildLockKey(lockId);
    // const sessionKey = randomUUID();
    const waitStartedAt = Date.now();

    const pendingTransactions = await this.transactionPoolService.getPendingTransactions(lockId);

    // If there are multiple pending transactions, we should reorder the queue by nonce
    const parsedTransactions = Array.from(pendingTransactions).map((txRlpHex) => ethers.Transaction.from(txRlpHex));

    // Sort pending transactions by nonce
    const sortedPendingTransactions = parsedTransactions.sort((a, b) => a.nonce - b.nonce).map((tx) => tx.serialized);

    // store sortedPendingTransactions in sessionQueues for different processes to access
    // const currentSessionQueue = this.sessionQueues.get(lockKey) || [];
    // this.sessionQueues.set(lockKey, [...new Set([...currentSessionQueue, ...sortedPendingTransactions])]);
    this.sessionQueues.set(lockKey, sortedPendingTransactions);

    try {
      // Poll until first in queue to acquire the lock, or until exceeding timeout
      while (Date.now() - waitStartedAt < this.lockAcquisitionTimeoutMs) {
        // Get the first session in the queue for this lock
        const firstPendingTransaction = this.sessionQueues.get(lockKey)![0];

        // Check if this session is first in queue and lock is not held
        // if (firstInQueue === sessionKey && !this.lockStorage.has(lockKey)) {
        if (firstPendingTransaction === rlpHex && !this.lockStorage.has(lockKey)) {
          // Acquire lock only when lock does not exist
          // This ensures only one client can hold the lock at a time
          this.lockStorage.set(lockKey, rlpHex);

          const waitDurationMs = Date.now() - waitStartedAt;
          // this.logger.debug(`Local lock acquired: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);
          this.logger.debug(`Local lock acquired: ${lockId}, waited ${waitDurationMs}ms, session: ${rlpHex}`);

          return;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, this.acquisitionPollIntervalMs));
      }

      // Lock acquisition process timed out
      throw new Error('Lock acquisition timeout');
    } catch (error) {
      const waitDurationMs = Date.now() - waitStartedAt;
      if (error instanceof Error && error.message.includes('timeout')) {
        // this.logger.warn(`Lock acquisition timeout: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);
        this.logger.warn(`Lock acquisition timeout: ${lockId}, waited ${waitDurationMs}ms, session: ${rlpHex}`);
      } else {
        this.logger.warn(
          // `Unexpected error during local lock acquisition for ${lockId} after ${waitDurationMs}ms for session ${sessionKey}`,
          `Unexpected error during local lock acquisition for ${lockId} after ${waitDurationMs}ms for session ${rlpHex}`,
          error,
        );
      }
    }
  }

  /**
   * Releases a local lock for the specified resource.
   *
   * Validates session key before releasing to prevent unauthorized release.
   * Silently succeeds if lock is already released.
   *
   * @param lockId - The unique identifier of the resource to release the lock for
   * @param sessionKey - The unique session key returned from acquireLock()
   * @returns Promise that resolves when the lock is released
   */
  async releaseLock(lockId: string, sessionKey: string): Promise<void> {
    const lockKey = this.buildLockKey(lockId);
    const currenSessionKey = this.lockStorage.get(lockKey);

    // Remove the session from the queue after releasing the lock
    // before releaseing the lock
    const currentPendingTransactions = this.sessionQueues.get(lockKey);

    if (!currentPendingTransactions) {
      return;
    }
    const currentTransactionIndex = currentPendingTransactions.indexOf(sessionKey);

    if (currentTransactionIndex !== -1) {
      currentPendingTransactions.splice(currentTransactionIndex, 1);
    }

    // Automatically deletes the queue entry if it becomes empty after removal - avoid accumulation
    if (currentPendingTransactions.length === 0) {
      this.sessionQueues.delete(lockKey);
    }

    // Ensure the lock is still valid and owned by the current session before releasing,
    // preventing double-release or invalid session releases.
    if (currenSessionKey === sessionKey) {
      try {
        // Delete lock entry to release the lock
        this.lockStorage.delete(lockKey);
        this.logger.debug(`Local lock released: ${lockId}, session: ${sessionKey}`);
      } catch (error) {
        this.logger.warn(`Error releasing local lock for ${lockId}:`, error);
      }
    }
  }

  /**
   * Builds the lock key for a given lock ID.
   * @param lockId - The unique identifier of the resource to lock
   * @returns The lock key used for the local lock
   */
  private buildLockKey(lockId: string): string {
    return `lock:${lockId.toLowerCase()}`;
  }
}
