// SPDX-License-Identifier: Apache-2.0

import { ethers } from 'ethers';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

import { TransactionPoolService } from '../../types/transactionPool';

export class LockService {
  private static readonly LOCK_KEY_PREFIX = 'lock:';
  private readonly lockAcquisitionTimeoutMs = 900000;
  private readonly lockTtlMs = 9000;
  private readonly acquisitionPollIntervalMs = 50;

  /**
   * LRU cache configuration for lock storage.
   *
   * - ttl: Locks auto-expire after lockTtlMs to prevent deadlocks
   * - ttlAutopurge: Ensures expired locks are removed automatically to prevent memory leaks
   */
  private readonly lockLruCacheOptions = {
    ttl: this.lockTtlMs,
    ttlAutopurge: true,
  } as const;

  /**
   * LRU cache mapping internal lock keys to the current holder's session identifier.
   * Each entry represents an active lock held by a specific session.
   */
  private readonly lockStorage: LRUCache<string, string>;

  /**
   * Map of internal lock keys to FIFO arrays of waiting session identifiers.
   *
   * Queues represent coordination metadata without TTL - they exist as long as
   * sessions are queued and are deleted deterministically when empty.
   * This design prevents accumulation of stale queue entries.
   */
  private readonly sessionQueues: Map<string, string[]>;

  constructor(
    private readonly logger: Logger,
    private readonly transactionPoolService: TransactionPoolService,
  ) {
    this.lockStorage = new LRUCache<string, string>(this.lockLruCacheOptions);
    this.sessionQueues = new Map<string, string[]>();
    this.logger.info(
      `LockService initialized: lockAcquisitionTimeoutMs=${this.lockAcquisitionTimeoutMs}ms, lockTtlMs=${this.lockTtlMs}ms, acquisitionPollIntervalMs=${this.acquisitionPollIntervalMs}ms`,
    );
  }

  /**
   * Acquires a lock for the specified resource identifier.
   *
   * This method implements a FIFO queue-based locking mechanism with priority ordering:
   * 1. Retrieves all pending items for the lockId from the data source
   * 2. Orders items by priority to establish proper queue sequence
   * 3. Computes a unique session identifier from the provided sessionKey using keccak256
   * 4. Polls the queue until this session is first and no other lock is held
   * 5. Acquires the lock when conditions are met
   *
   * The method polls the queue position at regular intervals until either:
   * - The lock is successfully acquired (first in queue and lock available)
   * - The acquisition timeout is reached (logs warning but does not throw)
   *
   * @param lockId - The unique identifier for the resource to lock
   * @param sessionKey - The unique identifier for this session (will be hashed internally)
   * @returns A promise that resolves when the lock is acquired or acquisition fails
   */
  async acquireLock(lockId: string, sessionKey: string): Promise<void> {
    const lockKey = this.buildLockKey(lockId);
    const waitStartedAt = Date.now();

    // Compute unique session identifier
    const computedSessionKey = this.computeSessionKey(sessionKey);

    // Retrieve all pending items for this lockId from TxPool pending storage
    const pendingItems = await this.transactionPoolService.getPendingTransactions(lockId);

    if (pendingItems.size > 0) {
      // Parse and order pending items by priority to establish proper queue sequence
      const parsedItems = Array.from(pendingItems).map((itemData) => ethers.Transaction.from(itemData));
      const orderedSessionKeys = parsedItems
        .sort((a, b) => a.nonce - b.nonce)
        .map((item) => ethers.keccak256(item.serialized));

      // Store the ordered queue for this lock to coordinate access across sessions
      this.sessionQueues.set(lockKey, orderedSessionKeys);
      this.logger.debug(
        `Lock queue established from pending items: lockId=${lockId}, queueLength=${orderedSessionKeys.length}`,
      );
    } else {
      // Get or create session queue for this lock
      let sessionQueue = this.sessionQueues.get(lockKey);
      if (!sessionQueue) {
        sessionQueue = [];
        this.sessionQueues.set(lockKey, sessionQueue);
      }

      // Enqueue the session key
      sessionQueue.push(computedSessionKey);
      this.logger.debug(`New item joined lock queue: lockId=${lockId}, session=${computedSessionKey}`);
    }

    try {
      // Poll until first in queue to acquire the lock, or until timeout is reached
      while (true) {
        // Get the first session in the queue for this lock
        const firstInQueue = this.sessionQueues.get(lockKey)![0];

        // Check if this session is first in queue and no lock is currently held
        if (computedSessionKey === firstInQueue && !this.lockStorage.has(lockKey)) {
          // Acquire lock - this ensures only one session can proceed at a time
          this.lockStorage.set(lockKey, computedSessionKey);

          const waitDurationMs = Date.now() - waitStartedAt;
          this.logger.debug(
            `Lock acquired: lockId=${lockId}, waitDurationMs=${waitDurationMs}, sessionKey=${computedSessionKey}`,
          );

          return;
        }

        // Wait before next poll to avoid excessive CPU usage
        await new Promise((resolve) => setTimeout(resolve, this.acquisitionPollIntervalMs));
      }
    } catch (error) {
      const waitDurationMs = Date.now() - waitStartedAt;
      if (error instanceof Error && error.message.includes('timeout')) {
        this.logger.warn(
          `Lock acquisition timeout: lockId=${lockId}, waitDurationMs=${waitDurationMs}, sessionKey=${sessionKey}`,
        );
      } else {
        this.logger.warn(
          `Unexpected error during lock acquisition: lockId=${lockId}, waitDurationMs=${waitDurationMs}, sessionKey=${sessionKey}`,
          error,
        );
      }
    }
  }

  /**
   * Releases the lock for the specified resource identifier.
   *
   * This method performs the following operations:
   * 1. Validates that the lock is owned by the current session before releasing
   * 2. Removes the session from the queue
   * 3. Cleans up the queue if it becomes empty to prevent memory accumulation
   * 4. Releases the lock to allow the next session to proceed
   *
   * The method is designed to be idempotent - it silently succeeds if the lock
   * is already released or if the session is not in the queue.
   *
   * @param lockId - The unique identifier for the resource to release the lock for
   * @param sessionKey - The unique identifier for this session (will be hashed internally)
   * @returns A promise that resolves when the lock is released
   */
  async releaseLock(lockId: string, sessionKey: string): Promise<void> {
    const lockKey = this.buildLockKey(lockId);
    const currentSessionKey = this.lockStorage.get(lockKey);

    // Compute session identifier from the provided sessionKey for validation
    const computedSessionKey = this.computeSessionKey(sessionKey);

    // Validate lock ownership before releasing to prevent unauthorized or duplicate releases
    if (computedSessionKey === currentSessionKey) {
      try {
        // Remove the session from the queue
        const currentQueue = this.sessionQueues.get(lockKey);
        if (!currentQueue) return;
        const sessionIndex = currentQueue.indexOf(computedSessionKey);
        if (sessionIndex !== -1) {
          currentQueue.splice(sessionIndex, 1);
        }
        // Clean up the queue entry if it becomes empty to prevent memory accumulation
        if (currentQueue.length === 0) {
          this.sessionQueues.delete(lockKey);
        }

        // Release the lock to allow next session to proceed
        this.lockStorage.delete(lockKey);
        this.logger.debug(`Lock released: lockId=${lockId}, sessionKey=${computedSessionKey}`);
      } catch (error) {
        this.logger.warn(`Error releasing lock: lockId=${lockId}`, error);
      }
    }
  }

  /**
   * Builds a standardized internal lock key from a resource identifier.
   *
   * The lock key is used internally to manage locks in the storage system.
   * All identifiers are normalized to lowercase to ensure consistency.
   *
   * @param lockId - The resource identifier to create a lock key for
   * @returns The standardized lock key with prefix (e.g., "lock:resource-123")
   */
  private buildLockKey(lockId: string): string {
    return `${LockService.LOCK_KEY_PREFIX}${lockId.toLowerCase()}`;
  }

  /**
   * Computes a unique session identifier from the provided sessionKey using keccak256 hash.
   *
   * This ensures consistent identification across the locking system regardless of
   * the original sessionKey format.
   *
   * @param sessionKey - The session identifier to hash
   * @returns The computed keccak256 hash of the session key
   */
  private computeSessionKey(sessionKey: string): string {
    return ethers.keccak256(sessionKey);
  }
}
