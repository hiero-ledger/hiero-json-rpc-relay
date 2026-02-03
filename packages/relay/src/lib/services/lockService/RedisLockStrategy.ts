// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { randomUUID } from 'crypto';
import { Logger } from 'pino';
import { RedisClientType } from 'redis';

import { LockAcquisitionResult, LockStrategy } from '../../types/lock';
import { LockMetricsService } from './LockMetricsService';
import { LockService } from './LockService';

/**
 * Redis-based distributed lock strategy implementing FIFO queue semantics with crash resilience.
 *
 * Uses Redis SET NX + LIST for distributed locking across multiple relay instances.
 * Provides automatic TTL-based expiration, polling-based lock acquisition, and heartbeat-based
 * zombie detection to prevent permanent deadlocks on process crashes.
 *
 * @remarks
 * - Lock keys: `{prefix}:{address}` stores current holder's session key
 * - Queue keys: `{prefix}:queue:{address}` stores FIFO queue of waiters
 * - Heartbeat keys: `{prefix}:heartbeat:{sessionKey}` proves waiter liveness
 * - TTL on lock and heartbeat keys provides automatic cleanup on crashes/hangs
 * - Active waiters act as "janitors" to prune dead entries from the queue
 */
export class RedisLockStrategy implements LockStrategy {
  readonly type: string = 'redis';
  private readonly redisClient: RedisClientType;
  private readonly logger: Logger;
  private readonly lockMetricsService: LockMetricsService;
  private readonly maxLockHoldMs: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatTtlMs: number;
  private readonly keyPrefix = 'lock';

  constructor(redisClient: RedisClientType, logger: Logger, lockMetricsService: LockMetricsService) {
    this.redisClient = redisClient;
    this.logger = logger;
    this.lockMetricsService = lockMetricsService;
    this.maxLockHoldMs = ConfigService.get('LOCK_MAX_HOLD_MS');
    this.pollIntervalMs = ConfigService.get('LOCK_QUEUE_POLL_INTERVAL_MS');

    // Heartbeat TTL is LOCK_HEARTBEAT_MISSED_COUNT times the poll interval.
    // A process must miss this many consecutive heartbeats to be considered dead.
    const heartbeatMissedCount: number = ConfigService.get('LOCK_HEARTBEAT_MISSED_COUNT');
    this.heartbeatTtlMs = this.pollIntervalMs * heartbeatMissedCount;
  }

  /**
   * Acquires a lock for the specified address using FIFO queue semantics.
   *
   * @param address - The sender address to acquire the lock for (will be normalized).
   * @returns A promise that resolves to a LockAcquisitionResult upon successful acquisition, or undefined if acquisition fails (fail open).
   */
  async acquireLock(address: string): Promise<LockAcquisitionResult | undefined> {
    const sessionKey = this.generateSessionKey();
    const lockKey = this.getLockKey(address);
    const queueKey = this.getQueueKey(address);
    const heartbeatKey = this.getHeartbeatKey(sessionKey);
    const startTime = process.hrtime.bigint();
    let joinedQueue = false;

    try {
      // Join FIFO queue
      await this.redisClient.lPush(queueKey, sessionKey);
      joinedQueue = true;

      this.lockMetricsService.incrementWaitingTxns('redis');
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`Lock acquisition started: address=${address}, sessionKey=${sessionKey}`);
      }

      // Poll until first in queue and can acquire lock
      while (true) {
        // Refresh own heartbeat of the active waiter (Proof of Life)
        // note: `1` is just a placeholder value and doesn't matter, only TTL matters
        await this.redisClient.set(heartbeatKey, '1', { PX: this.heartbeatTtlMs });

        // Check if first in line
        const firstInQueue = await this.redisClient.lIndex(queueKey, -1);

        if (firstInQueue === sessionKey) {
          // Try to acquire lock with TTL
          const acquired = await this.redisClient.set(lockKey, sessionKey, {
            NX: true, // Only set if not exists
            PX: this.maxLockHoldMs, // TTL in milliseconds
          });

          if (acquired) {
            const acquiredAt = process.hrtime.bigint();
            //convert to seconds
            const acquisitionDuration = Number(acquiredAt - startTime) / 1e9;
            const queueLength = await this.redisClient.lLen(queueKey);

            this.lockMetricsService.recordWaitTime('redis', acquisitionDuration);
            this.lockMetricsService.recordAcquisition('redis', 'success');
            this.lockMetricsService.incrementActiveCount('redis');

            if (this.logger.isLevelEnabled('debug')) {
              this.logger.debug(
                `Lock acquired: address=${address}, sessionKey=${sessionKey}, duration=${acquisitionDuration}ms, queueLength=${queueLength}`,
              );
            }

            return { sessionKey, acquiredAt };
          }
        } else if (firstInQueue) {
          // Remove zombie (crashed waiter with no heartbeat)
          const heartbeatExists = await this.redisClient.exists(this.getHeartbeatKey(firstInQueue));
          if (!heartbeatExists) {
            await this.redisClient.lRem(queueKey, 0, firstInQueue);
            this.lockMetricsService.recordZombieCleanup();
            continue; // Immediate retry (no sleep)
          }
        }

        // Wait before checking again
        await this.sleep(this.pollIntervalMs);
      }
    } catch (error) {
      this.logger.error(error, `Failed to acquire lock: address=${address}, sessionKey=${sessionKey}. Failing open.`);
      // Record failed acquisition
      this.lockMetricsService.recordAcquisition('redis', 'fail');
      this.lockMetricsService.incrementRedisLockErrors('acquire');
      return;
    } finally {
      // Always remove from queue if we joined it (whether success or failure)
      if (joinedQueue) {
        this.lockMetricsService.decrementWaitingTxns('redis');
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
   * @param acquiredAt - The timestamp when the lock was acquired (for metrics calculation).
   */
  async releaseLock(address: string, sessionKey: string, acquiredAt?: bigint): Promise<void> {
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
        if (acquiredAt) {
          const holdDurationNs = process.hrtime.bigint() - acquiredAt;
          this.lockMetricsService.recordHoldDuration('redis', Number(holdDurationNs) / 1e9);
        }
        this.lockMetricsService.decrementActiveCount('redis');

        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`Lock released: address=${address}, sessionKey=${sessionKey}`);
        }
      } else {
        // Lock was already released (likely due to TTL timeout) or owned by someone else
        if (acquiredAt) {
          const holdDurationNs = process.hrtime.bigint() - acquiredAt;
          const holdDurationMs = Number(holdDurationNs) / 1e6;
          // If hold duration exceeds max hold time, it was a timeout release
          if (holdDurationMs >= this.maxLockHoldMs) {
            this.lockMetricsService.recordHoldDuration('redis', Number(holdDurationNs) / 1e9);
            this.lockMetricsService.recordTimeoutRelease('redis');
            this.lockMetricsService.decrementActiveCount('redis');
          }
        }

        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(
            `Lock release ignored (not owner or already released): address=${address}, sessionKey=${sessionKey}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(error, `Failed to release lock: address=${address}, sessionKey=${sessionKey}`);
      this.lockMetricsService.incrementRedisLockErrors('release');
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
   * Generates the Redis key for a heartbeat.
   *
   * @param sessionKey - The session key.
   * @returns The Redis heartbeat key.
   */
  private getHeartbeatKey(sessionKey: string): string {
    return `${this.keyPrefix}:heartbeat:${sessionKey}`;
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
