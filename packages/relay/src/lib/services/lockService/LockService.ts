// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import { LocalLockStrategy } from './LocalLockStrategy';
import { LockStrategy } from './LockStrategy';
import { RedisLockStrategy } from './RedisLockStrategy';

export class LockService {
  /** Lock acquisition timeout - how long a request waits before giving up (5 minutes) */
  private static readonly DEFAULT_LOCK_TIMEOUT_MS = 300_000;

  /** Prevents memory leaks from abandoned locks (15 minutes) */
  private static readonly LOCK_TTL_MS = 15 * 60 * 1000;

  /** Maximum concurrent resource locks to track (LRU eviction beyond this) */
  private static readonly MAX_LOCKS = 1000;

  /** Redis queue polling interval - checks FIFO position every 50ms */
  private static readonly REDIS_POLL_INTERVAL_MS = 50;

  private readonly lockStrategy: LockStrategy;

  /**
   * Creates a new LockService instance.
   * Automatically selects the appropriate locking strategy based on configuration.
   *
   * @param logger - Logger instance for debugging and monitoring lock operations
   */
  constructor(logger: Logger) {
    // Initialize LocalLockStrategy as default lock strategy
    this.lockStrategy = new LocalLockStrategy(
      logger.child({ name: 'local-lock' }),
      LockService.DEFAULT_LOCK_TIMEOUT_MS,
      LockService.LOCK_TTL_MS,
      LockService.MAX_LOCKS,
    );

    // Initialize RedisLockStrategy
    const redisLockStrategy = new RedisLockStrategy(
      logger.child({ name: 'redis-lock' }),
      LockService.DEFAULT_LOCK_TIMEOUT_MS,
      LockService.LOCK_TTL_MS,
      LockService.REDIS_POLL_INTERVAL_MS,
    );

    if (this.isRedisEnabled()) {
      // Switch to RedisLockStrategy if redis is enabled
      this.lockStrategy = redisLockStrategy;
      logger.info(
        `Using Redis distributed locking for main Lock Service: lockTimeoutMs=${LockService.DEFAULT_LOCK_TIMEOUT_MS}, lockTtlMs=${LockService.LOCK_TTL_MS}`,
      );
    } else {
      logger.info(
        `Using local in-memory locking for main Lock Service: lockTimeoutMs=${LockService.DEFAULT_LOCK_TIMEOUT_MS}, lockTtlMs=${LockService.LOCK_TTL_MS}, maxLocks=${LockService.MAX_LOCKS}`,
      );
    }
  }

  /**
   * Acquires a lock for the specified resource.
   *
   * @param lockId - The unique identifier of the resource to lock
   * @returns Promise resolving to a unique session key for lock release
   * @throws Error if lock acquisition fails or times out
   */
  async acquireLock(lockId: string): Promise<string> {
    return this.lockStrategy.acquireLock(lockId);
  }

  /**
   * Releases a previously acquired lock.
   *
   * @param lockId - The unique identifier of the resource to unlock
   * @param sessionKey - The session key returned from acquireLock()
   * @returns Promise resolving when lock is released
   */
  async releaseLock(lockId: string, sessionKey: string): Promise<void> {
    return this.lockStrategy.releaseLock(lockId, sessionKey);
  }

  /**
   * Checks whether Redis is enabled based on environment variables.
   * @private
   * @returns {boolean} Returns true if Redis is enabled, otherwise false.
   */
  private isRedisEnabled(): boolean {
    return ConfigService.get('REDIS_ENABLED') && !!ConfigService.get('REDIS_URL');
  }
}
