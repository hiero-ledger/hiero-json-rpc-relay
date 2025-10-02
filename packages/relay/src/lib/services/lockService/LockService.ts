// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import { LocalLockStrategy } from './LocalLockStrategy';
import { LockStrategy } from './LockStrategy';
import { RedisLockStrategy } from './RedisLockStrategy';

export class LockService {
  /**
   * The underlying lock strategy used for lock operations.
   */
  private readonly lockStrategy: LockStrategy;

  /**
   * Creates a new LockService instance.
   * Automatically selects the appropriate locking strategy based on configuration.
   *
   * @param logger - Logger instance for debugging and monitoring lock operations
   */
  constructor(logger: Logger) {
    // Initialize LocalLockStrategy as default lock strategy
    this.lockStrategy = new LocalLockStrategy(logger.child({ name: 'local-lock' }));

    // Initialize RedisLockStrategy
    const redisLockStrategy = new RedisLockStrategy(logger.child({ name: 'redis-lock' }));

    if (this.isRedisEnabled()) {
      this.lockStrategy = redisLockStrategy;
      logger.info('Lock Service main strategy set to Redis-distributed locking.');
    } else {
      logger.info('Lock Service main strategy set to local in-memory locking.');
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
