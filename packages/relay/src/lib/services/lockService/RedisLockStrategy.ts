// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { randomUUID } from 'crypto';
import { Logger } from 'pino';
import { RedisClientType } from 'redis';

import { LockStrategy } from '../../types/lock';
import { LockService } from './LockService';

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
  private readonly keyPrefix = 'lock';

  constructor(redisClient: RedisClientType, logger: Logger) {
    this.redisClient = redisClient;
    this.logger = logger;
    this.maxLockHoldMs = ConfigService.get('LOCK_MAX_HOLD_MS');
    this.pollIntervalMs = ConfigService.get('LOCK_QUEUE_POLL_INTERVAL_MS');
  }

  /**
   * Acquires a lock for the specified address using FIFO queue semantics.
   *
   * @param address - The sender address to acquire the lock for (will be normalized).
   * @returns A promise that resolves to a unique session key upon successful acquisition, or null if acquisition fails (fail open).
   */
  async acquireLock(address: string): Promise<string | null> {
    const sessionKey = this.generateSessionKey();
    const lockKey = this.getLockKey(address);
    const queueKey = this.getQueueKey(address);
    const startTime = Date.now();
    let joinedQueue = false;

    try {
      // Join FIFO queue
      await this.redisClient.lPush(queueKey, sessionKey);
      joinedQueue = true;

      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`Lock acquisition started: address=${address}, sessionKey=${sessionKey}`);
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
            const acquisitionDuration = Date.now() - startTime;
            const queueLength = await this.redisClient.lLen(queueKey);

            if (this.logger.isLevelEnabled('debug')) {
              this.logger.debug(
                `Lock acquired: address=${address}, sessionKey=${sessionKey}, duration=${acquisitionDuration}ms, queueLength=${queueLength}`,
              );
            }

            return sessionKey;
          }
        }

        // Wait before checking again
        await this.sleep(this.pollIntervalMs);
      }
    } catch (error) {
      this.logger.error(error, `Failed to acquire lock: address=${address}, sessionKey=${sessionKey}. Failing open.`);
      return null;
    } finally {
      // Always remove from queue if we joined it (whether success or failure)
      if (joinedQueue) {
        await this.removeFromQueue(queueKey, sessionKey, address);
      }
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
    const lockKey = this.getLockKey(address);

    try {
      // Atomic check-and-delete using Lua script
      // Only deletes the lock if the session key matches (ownership check)
      const result = await this.redisClient.eval(
        `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `,
        {
          keys: [lockKey],
          arguments: [sessionKey],
        },
      );

      if (result === 1) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`Lock released: address=${address}, sessionKey=${sessionKey}`);
        }
      } else {
        // Lock was already released or owned by someone else - ignore
        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(
            `Lock release ignored (not owner or already released): address=${address}, sessionKey=${sessionKey}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(error, `Failed to release lock: address=${address}, sessionKey=${sessionKey}`);
      // Don't throw - release failures should not block the caller
    }
  }

  /**
   * Generates the Redis key for a lock.
   * Automatically normalizes the address to ensure consistency.
   *
   * @param address - The sender address (will be normalized to lowercase).
   * @returns The Redis lock key.
   */
  private getLockKey(address: string): string {
    const normalizedAddress = LockService.normalizeAddress(address);
    return `${this.keyPrefix}:${normalizedAddress}`;
  }

  /**
   * Generates the Redis key for a lock queue.
   * Automatically normalizes the address to ensure consistency.
   *
   * @param address - The sender address (will be normalized to lowercase).
   * @returns The Redis queue key.
   */
  private getQueueKey(address: string): string {
    const normalizedAddress = LockService.normalizeAddress(address);
    return `${this.keyPrefix}:queue:${normalizedAddress}`;
  }

  /**
   * Removes a session key from the queue.
   * Used for cleanup after successful acquisition or on error.
   *
   * @param queueKey - The queue key.
   * @param sessionKey - The session key to remove.
   * @param address - The address (for logging).
   */
  private async removeFromQueue(queueKey: string, sessionKey: string, address: string): Promise<void> {
    try {
      await this.redisClient.lRem(queueKey, 1, sessionKey);
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`Removed from queue: address=${address}, sessionKey=${sessionKey}`);
      }
    } catch (error) {
      this.logger.warn(error, `Failed to remove from queue: address=${address}, sessionKey=${sessionKey}`);
    }
  }

  /**
   * Generates a unique session key for lock acquisition.
   * Protected to allow test mocking.
   *
   * @returns A unique session key.
   */
  protected generateSessionKey(): string {
    return randomUUID();
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
