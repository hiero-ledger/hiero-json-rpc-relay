// SPDX-License-Identifier: Apache-2.0

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
  private readonly lockStates: LRUCache<string, LockState>;

  /**
   * Creates a new LocalLockStrategy instance.
   *
   * @param logger - Logger instance for debugging and monitoring
   * @param lockTimeoutMs - Lock acquisition timeout in milliseconds
   * @param stateTtlMs - Lock state TTL for cleanup in milliseconds
   * @param maxLocks - Maximum number of locks to track in LRU cache
   */
  constructor(
    private readonly logger: Logger,
    private readonly lockTimeoutMs: number,
    private readonly stateTtlMs: number,
    private readonly maxLocks: number,
  ) {
    this.lockStates = new LRUCache<string, LockState>({
      max: this.maxLocks,
      ttl: this.stateTtlMs,
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
  }

  /**
   * Acquires a local mutex lock for the specified resource.
   *
   * Uses async-mutex with timeout protection and session key tracking.
   * If the lock is not available, waits up to lockTimeoutMs before throwing.
   *
   * @param lockId - The unique identifier of the resource to acquire the lock for
   * @returns Promise that resolves to a unique session key when the lock is acquired
   * @throws Error if lock acquisition fails or timeout occurs
   */
  async acquireLock(lockId: string): Promise<string> {
    const lockKey = this.buildLockKey(lockId);
    let lockState = this.lockStates.get(lockKey);

    if (!lockState) {
      lockState = {
        mutex: new Mutex(),
        activeSessionKeys: new Set<string>(),
      };
      this.lockStates.set(lockKey, lockState);
    }

    const timeoutMutex = withTimeout(lockState.mutex, this.lockTimeoutMs);
    const waitStartedAt = Date.now();
    const sessionKey = randomUUID();

    try {
      await timeoutMutex.acquire();
      lockState.activeSessionKeys.add(sessionKey);

      const waitDurationMs = Date.now() - waitStartedAt;
      this.logger.debug(`Local lock acquired: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);

      return sessionKey;
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(`Failed to acquire lock for resource ${lockId}: timeout after ${this.lockTimeoutMs}ms`);
      }
      this.logger.error(`Failed to acquire lock for ${lockId}:`, error);
      throw error;
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
