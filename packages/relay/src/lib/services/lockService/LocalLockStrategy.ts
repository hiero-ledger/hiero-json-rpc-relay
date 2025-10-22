// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';
import { Mutex, MutexInterface, withTimeout } from 'async-mutex';

import { LockStrategy } from './LockStrategy';

export class LocalLockStrategy implements LockStrategy {
  /**
   * Maximum time in milliseconds to wait for lock acquisition before timing out.
   */
  private readonly lockAcquisitionTimeoutMs = ConfigService.get('LOCK_ACQUISITION_TIMEOUT_MS');

  /**
   * Maximum duration in milliseconds that a lock can exist before automatic expiration.
   */
  private readonly lockTtlMs = ConfigService.get('LOCK_TTL_MS');

  /**
   * Polling interval in milliseconds for checking queue position during lock acquisition.
   */
  private readonly acquisitionPollIntervalMs = ConfigService.get('LOCK_ACQUISITION_POLL_INTERVAL_MS');

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

  private readonly locksMap: LRUCache<string, any>;

  /**
   * Creates a new LocalLockStrategy instance.
   *
   * @param logger - Logger instance for debugging and monitoring
   */
  constructor(private readonly logger: Logger) {
    this.lockStorage = new LRUCache<string, string>(this.lockLruCacheOptions);
    this.sessionQueues = new Map<string, string[]>();
    this.logger.info(
      `Local lock strategy initialized: lockAcquisitionTimeoutMs=${this.lockAcquisitionTimeoutMs}ms, lockTtlMs=${this.lockTtlMs}ms, acquisitionPollIntervalMs=${this.acquisitionPollIntervalMs}ms`,
    );

    this.locksMap = new LRUCache<string, any>({
      max: 1000,
    });
  }

  /**
   * Acquires a local lock for the specified resource.
   *
   * @param lockId - The unique identifier for the resource to lock.
   * @returns A promise that resolves to the session key if the lock is successfully acquired, or null if error occurs.
   */
  async acquireLock(lockId: string): Promise<string | null> {
    const lockKey = this.buildLockKey(lockId);
    const sessionKey = randomUUID();
    const waitStartedAt = Date.now();

    let mutex: Mutex;

    try {
      if (this.locksMap.has(lockKey)) {
        mutex = this.locksMap.get(lockKey)!;
      } else {
        mutex = new Mutex();
        this.locksMap.set(lockKey, mutex);
      }

      let isTimeout = false;

      const handler = setTimeout(() => {
        isTimeout = true;
        mutex.release();
        console.log(`Deleted mutex for ${lockKey} from locksMap}`);
      }, 9000);

      console.log(`Attempting to acquire mutex lock for ${lockKey}}`);
      await mutex.acquire();
      this.lockStorage.set(lockKey, sessionKey);
      console.log(`Mutex lock acquired for ${lockKey}}`);
      if (!isTimeout) {
        console.log(`Clearing timeout handler for ${lockKey}}`);
        clearTimeout(handler);
      } else {
        console.log(`Mutex lock acquisition timed out for ${lockKey}}`);
      }
    } catch (error) {
      console.error(`Failed to acquire mutex lock within timeout}:`, error);
    }

    return sessionKey;

    // // Get or create session queue for this lock
    // let sessionQueue = this.sessionQueues.get(lockKey);
    // if (!sessionQueue) {
    //   sessionQueue = [];
    //   this.sessionQueues.set(lockKey, sessionQueue);
    // }
    // try {
    //   // Enqueue the session key
    //   sessionQueue.unshift(sessionKey);
    //   this.logger.debug(`New item joined lock queue: lockId=${lockId}, session=${sessionKey}`);

    //   // Poll until first in queue to acquire the lock, or until exceeding timeout
    //   while (Date.now() - waitStartedAt < this.lockAcquisitionTimeoutMs) {
    //     const firstInQueue = sessionQueue[sessionQueue.length - 1];

    //     // Check if this session is first in queue and lock is not held
    //     if (firstInQueue === sessionKey && !this.lockStorage.has(lockKey)) {
    //       // Acquire lock only when lock does not exist
    //       // This ensures only one client can hold the lock at a time
    //       this.lockStorage.set(lockKey, sessionKey);

    //       const waitDurationMs = Date.now() - waitStartedAt;
    //       this.logger.debug(`Local lock acquired: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);

    //       return sessionKey;
    //     }

    //     // Wait before next poll
    //     await new Promise((resolve) => setTimeout(resolve, this.acquisitionPollIntervalMs));
    //   }

    //   // Lock acquisition process timed out
    //   throw new Error('Lock acquisition timeout');
    // } catch (error) {
    //   const waitDurationMs = Date.now() - waitStartedAt;
    //   if (error instanceof Error && error.message.includes('timeout')) {
    //     this.logger.warn(`Lock acquisition timeout: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);
    //   } else {
    //     this.logger.warn(
    //       `Unexpected error during local lock acquisition for ${lockId} after ${waitDurationMs}ms for session ${sessionKey}`,
    //       error,
    //     );
    //   }

    //   // Return null to signal that the lock was not acquired, allowing other processes
    //   // to continue without interruption instead of being blocked by an exception.
    //   return null;
    // } finally {
    //   // Remove session key from queue regardless of success or failure
    //   const sessionKeyIndex = sessionQueue.indexOf(sessionKey);
    //   if (sessionKeyIndex !== -1) {
    //     sessionQueue.splice(sessionKeyIndex, 1);
    //   }

    //   // Automatically deletes the queue entry if it becomes empty after removal - avoid accumulation
    //   if (sessionQueue.length === 0) {
    //     this.sessionQueues.delete(lockKey);
    //   }
    // }
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

    const mutex = this.locksMap.get(lockKey)!;
    console.log(`Using release existing mutex for ${lockKey}}`);

    if (currenSessionKey === sessionKey) {
      try {
        // Delete lock entry to release the lock
        this.lockStorage.delete(lockKey);
        mutex.release();
        console.log(`Mutex release lock released for ${lockKey}}`);
      } catch (error) {
        console.error(`Failed release to release mutex lock for ${lockKey}}:`, error);
      }
    }

    // Ensure the lock is still valid and owned by the current session before releasing,
    // preventing double-release or invalid session releases.
    // if (currenSessionKey === sessionKey) {
    //   try {
    //     // Delete lock entry to release the lock
    //     this.lockStorage.delete(lockKey);
    //     this.logger.debug(`Local lock released: ${lockId}, session: ${sessionKey}`);
    //   } catch (error) {
    //     this.logger.warn(`Error releasing local lock for ${lockId}:`, error);
    //   }
    // }
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
