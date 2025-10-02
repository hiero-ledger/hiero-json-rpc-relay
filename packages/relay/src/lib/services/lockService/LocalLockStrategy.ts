// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Mutex, withTimeout } from 'async-mutex';
import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';

import { LockStrategy } from './LockStrategy';

/**
 * Represents the state of a lock for a specific resource.
 * Encapsulates both the mutex and the active session keys for that lock.
 */
interface LockState {
  /** The mutex used for synchronization */
  mutex: Mutex;
  /** Set of active session keys that can release this lock */
  activeSessionKeys: Set<string>;
}

export class LocalLockStrategy implements LockStrategy {
  /**
   * Maximum time in milliseconds to wait for lock acquisition before timing out.
   */
  private readonly lockAcquisitionTimeoutMs = ConfigService.get('LOCK_ACQUISITION_TIMEOUT_MS');

  /**
   * LRU cache storing lock states indexed by lock ID.
   * Automatically evicts least recently used locks when capacity is exceeded.
   */
  private readonly lockStates: LRUCache<string, LockState>;

  /**
   * Creates a new LocalLockStrategy instance.
   *
   * @param logger - Logger instance for debugging and monitoring
   */
  constructor(private readonly logger: Logger) {
    const lockLocalMaxCapacity = ConfigService.get('LOCK_LOCAL_MAX_CAPACITY');
    const lockTtlMs = ConfigService.get('LOCK_TTL_MS');

    this.lockStates = new LRUCache<string, LockState>({
      max: lockLocalMaxCapacity,
      ttl: lockTtlMs,
      dispose: (lockState: LockState, lockId: string) => {
        if (lockState.mutex.isLocked()) {
          try {
            lockState.mutex.release();
            this.logger.debug(`Active lock auto-released during cleanup for resource: ${lockId}`);
          } catch (error) {
            this.logger.warn(`Error auto-releasing lock during cleanup for resource: ${lockId}`, error);
          }
        }
        lockState.activeSessionKeys.clear();
      },
    });
    this.logger.info(
      `Local lock strategy initialized: lockAcquisitionTimeoutMs=${this.lockAcquisitionTimeoutMs}ms, lockTtlMs=${lockTtlMs}ms, lockLocalMaxCapacity=${lockLocalMaxCapacity}`,
    );
  }

  /**
   * Acquires a local mutex lock for the specified resource.
   *
   * Uses async-mutex with timeout protection and session key tracking.
   *
   * @param lockId - The unique identifier of the resource to acquire the lock for
   * @returns Promise that resolves to a unique session key when the lock is acquired, or null if error occurs
   */
  async acquireLock(lockId: string): Promise<string | null> {
    const lockKey = this.buildLockKey(lockId);
    let lockState = this.lockStates.get(lockKey);

    if (!lockState) {
      lockState = {
        mutex: new Mutex(),
        activeSessionKeys: new Set<string>(),
      };
      this.lockStates.set(lockKey, lockState);
    }

    const timeoutMutex = withTimeout(lockState.mutex, this.lockAcquisitionTimeoutMs);
    const waitStartedAt = Date.now();
    const sessionKey = randomUUID();

    try {
      await timeoutMutex.acquire();
      lockState.activeSessionKeys.add(sessionKey);

      const waitDurationMs = Date.now() - waitStartedAt;
      this.logger.debug(`Local lock acquired: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);

      return sessionKey;
    } catch (error) {
      const waitDurationMs = Date.now() - waitStartedAt;
      if (error instanceof Error && error.message.includes('timeout')) {
        this.logger.warn(`Lock acquisition timeout: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);
      } else {
        this.logger.warn(
          `Unexpected error during local lock acquisition for ${lockId} after ${waitDurationMs}ms for session ${sessionKey}`,
          error,
        );
      }

      // cleanup lock state if lock was acquired
      this.releaseLock(lockId, sessionKey);

      // Return null to signal that the lock was not acquired, allowing other processes
      // to continue without interruption instead of being blocked by an exception.
      return null;
    }
  }

  /**
   * Releases a local mutex lock for the specified resource.
   *
   * Validates session key before releasing to prevent double-release.
   * Silently succeeds if lock is already released or expired from LRU cache.
   *
   * @param lockId - The unique identifier of the resource to release the lock for
   * @param sessionKey - The unique session key returned from acquireLock()
   * @returns Promise that resolves when the lock is released
   */
  async releaseLock(lockId: string, sessionKey: string): Promise<void> {
    const lockKey = this.buildLockKey(lockId);
    const lockState = this.lockStates.get(lockKey);

    if (!lockState || !lockState.activeSessionKeys.has(sessionKey)) {
      // Lock already released or expired from LRU cache
      // Skip this case to avoid double-release attempts
      return;
    }

    try {
      lockState.mutex.release();
      this.logger.debug(`Local lock released: ${lockId}, session: ${sessionKey}`);
    } catch (error) {
      this.logger.error(`Error releasing local lock for ${lockId}:`, error);
    } finally {
      lockState.activeSessionKeys.delete(sessionKey);
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
