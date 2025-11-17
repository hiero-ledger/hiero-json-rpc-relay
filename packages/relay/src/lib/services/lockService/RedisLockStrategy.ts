// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { randomUUID } from 'crypto';
import { Logger } from 'pino';
import { RedisClientType } from 'redis';

import { RedisCacheError } from '../../errors/RedisCacheError';
import { LockStrategy } from '../../types/lock';

/**
 * Redis-based distributed lock strategy implementing FIFO queue semantics.
 *
 * Uses Redis SET NX + LIST for distributed locking across multiple relay instances.
 * Provides automatic TTL-based expiration and polling-based lock acquisition.
 *
 * @remarks
 * - Lock keys: `{prefix}:{address}` stores current holder's session key
 * - Queue keys: `{prefix}:queue:{address}` stores FIFO queue of waiters
 * - TTL on lock keys provides automatic cleanup on crashes/hangs
 */
export class RedisLockStrategy implements LockStrategy {
  private readonly redisClient: RedisClientType;
  private readonly logger: Logger;
  private readonly maxLockHoldMs: number;
  private readonly pollIntervalMs: number;
  private readonly keyPrefix: string;

  /**
   * Lua script for atomic lock release with ownership check.
   * Only deletes the lock if the session key matches.
   */
  private static readonly RELEASE_LOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  constructor(redisClient: RedisClientType, logger: Logger) {
    this.redisClient = redisClient;
    this.logger = logger;
    this.maxLockHoldMs = ConfigService.get('LOCK_MAX_HOLD_MS' as any) as number;
    this.pollIntervalMs = ConfigService.get('LOCK_QUEUE_POLL_INTERVAL_MS' as any) as number;
    this.keyPrefix = ConfigService.get('LOCK_REDIS_PREFIX' as any) as string;
  }

  /**
   * Acquires a lock for the specified address using FIFO queue semantics.
   *
   * @param address - The sender address to acquire the lock for (will be normalized).
   * @returns A promise that resolves to a unique session key upon successful acquisition.
   * @throws Error if acquisition times out or Redis connection fails.
   */
  async acquireLock(address: string): Promise<string> {
    const normalizedAddress = this.normalizeAddress(address);
    const sessionKey = randomUUID();
    const lockKey = this.getLockKey(normalizedAddress);
    const queueKey = this.getQueueKey(normalizedAddress);
    const startTime = Date.now();
    let joinedQueue = false;

    try {
      // Join FIFO queue
      await this.redisClient.lPush(queueKey, sessionKey);
      joinedQueue = true;

      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`Lock acquisition started: address=${normalizedAddress}, sessionKey=${sessionKey}`);
      }

      // Poll until first in queue and can acquire lock
      while (true) {
        // Check if first in line
        const firstInQueue = await this.redisClient.lIndex(queueKey, -1);

        if (firstInQueue === sessionKey) {
          // Try to acquire lock with TTL
          const acquired = await this.redisClient.set(lockKey, sessionKey, {
            NX: true, // Only set if not exists
            PX: this.maxLockHoldMs, // TTL in milliseconds
          });

          if (acquired) {
            // Successfully acquired - remove from queue
            await this.redisClient.rPop(queueKey);

            const acquisitionDuration = Date.now() - startTime;
            const queueLength = await this.redisClient.lLen(queueKey);

            this.logger.info(
              `Lock acquired: address=${normalizedAddress}, sessionKey=${sessionKey}, duration=${acquisitionDuration}ms, queueLength=${queueLength}`,
            );

            return sessionKey;
          }
        }

        // Wait before checking again
        await this.sleep(this.pollIntervalMs);
      }
    } catch (error) {
      // Best-effort cleanup: remove from queue if we joined it
      if (joinedQueue) {
        await this.cleanupFromQueue(queueKey, sessionKey, normalizedAddress);
      }

      const redisError = new RedisCacheError(error);
      this.logger.error(redisError, `Failed to acquire lock: address=${normalizedAddress}, sessionKey=${sessionKey}`);
      throw redisError;
    }
  }

  /**
   * Releases a lock for the specified address.
   * Only succeeds if the session key matches the current lock holder.
   *
   * @param address - The sender address to release the lock for (will be normalized).
   * @param sessionKey - The session key proving ownership of the lock.
   */
  async releaseLock(address: string, sessionKey: string): Promise<void> {
    const normalizedAddress = this.normalizeAddress(address);
    const lockKey = this.getLockKey(normalizedAddress);

    try {
      // Atomic check-and-delete using Lua script
      const result = await this.redisClient.eval(RedisLockStrategy.RELEASE_LOCK_SCRIPT, {
        keys: [lockKey],
        arguments: [sessionKey],
      });

      if (result === 1) {
        this.logger.info(`Lock released: address=${normalizedAddress}, sessionKey=${sessionKey}`);
      } else {
        // Lock was already released or owned by someone else - ignore
        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(
            `Lock release ignored (not owner or already released): address=${normalizedAddress}, sessionKey=${sessionKey}`,
          );
        }
      }
    } catch (error) {
      const redisError = new RedisCacheError(error);
      this.logger.error(redisError, `Failed to release lock: address=${normalizedAddress}, sessionKey=${sessionKey}`);
      // Don't throw - release failures should not block the caller
    }
  }

  /**
   * Normalizes an address to lowercase for consistent key generation.
   *
   * @param address - The address to normalize.
   * @returns The normalized address.
   */
  private normalizeAddress(address: string): string {
    return address.toLowerCase();
  }

  /**
   * Generates the Redis key for a lock.
   *
   * @param address - The normalized address.
   * @returns The Redis lock key.
   */
  private getLockKey(address: string): string {
    return `${this.keyPrefix}:${address}`;
  }

  /**
   * Generates the Redis key for a lock queue.
   *
   * @param address - The normalized address.
   * @returns The Redis queue key.
   */
  private getQueueKey(address: string): string {
    return `${this.keyPrefix}:queue:${address}`;
  }

  /**
   * Removes a session key from the queue (cleanup on error).
   *
   * @param queueKey - The queue key.
   * @param sessionKey - The session key to remove.
   * @param address - The address (for logging).
   */
  private async cleanupFromQueue(queueKey: string, sessionKey: string, address: string): Promise<void> {
    try {
      await this.redisClient.lRem(queueKey, 1, sessionKey);
      this.logger.warn(`Removed from queue due to error: address=${address}, sessionKey=${sessionKey}`);
    } catch (error) {
      const redisError = new RedisCacheError(error);
      this.logger.error(redisError, `Failed to cleanup from queue: address=${address}, sessionKey=${sessionKey}`);
    }
  }

  /**
   * Sleeps for the specified duration.
   *
   * @param ms - Duration in milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
