// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { randomUUID } from 'crypto';
import { Logger } from 'pino';
import { createClient, type RedisClientType } from 'redis';

import { LockStrategy } from './LockStrategy';

export class RedisLockStrategy implements LockStrategy {
  /**
   * Maximum time in milliseconds to wait for lock acquisition before timing out.
   */
  private readonly lockAcquisitionTimeoutMs = ConfigService.get('LOCK_ACQUISITION_TIMEOUT_MS');

  /**
   * Maximum duration in milliseconds that a lock can exist before automatic expiration in Redis.
   */
  private readonly lockTtlMs = ConfigService.get('LOCK_TTL_MS');

  /**
   * Polling interval in milliseconds for checking queue position during lock acquisition.
   */
  private readonly acquisitionPollIntervalMs = ConfigService.get('LOCK_ACQUISITION_POLL_INTERVAL_MS');

  /** Redis client instance for distributed locking operations. */
  private redisClient?: RedisClientType;

  /** Tracks Redis connection status. */
  private _isConnected: boolean = false;

  /**
   * Creates a new RedisLockStrategy instance and initializes Redis connection
   * if enabled and properly configured.
   *
   * @param logger - Logger instance for debugging and monitoring
   */
  constructor(private readonly logger: Logger) {
    // Initialize Redis client only if enabled and URL is provided
    if (ConfigService.get('REDIS_ENABLED')) {
      try {
        const redisUrl = ConfigService.get('REDIS_URL');

        this.redisClient = createClient({
          url: redisUrl,
          socket: {
            reconnectStrategy: (retries: number) => {
              const delay = retries * ConfigService.get('REDIS_RECONNECT_DELAY_MS');
              this.logger.warn(`Redis reconnection attempt #${retries} with delay ${delay}ms`);
              return delay;
            },
          },
        });

        this.redisClient.connect().catch((error) => {
          this.logger.error(error, 'Redis connection could not be established!');
          return false;
        });

        this.redisClient.on('ready', () => {
          this._isConnected = true;
        });

        this.redisClient.on('end', () => {
          this._isConnected = false;
        });

        this.redisClient.on('error', (error) => {
          this._isConnected = false;
          this.logger.error('Error occurred with Redis Connection during Redis Lock Strategy initialization:', error);
        });

        this.logger.info(
          `Redis lock strategy initialized: lockAcquisitionTimeoutMs=${this.lockAcquisitionTimeoutMs}ms, lockTtlMs=${this.lockTtlMs}ms, acquisitionPollIntervalMs=${this.acquisitionPollIntervalMs}ms`,
        );
      } catch (error) {
        this._isConnected = false;
        this.logger.error('Failed to create Redis client for Redis Lock Strategy:', error);
      }
    }
  }

  /**
   * Acquires a distributed lock for the specified resource using Redis.
   *
   * @param lockId - The unique identifier for the resource to lock.
   * @returns A promise that resolves to the session key if the lock is successfully acquired, or null if error occurs.
   */
  async acquireLock(lockId: string): Promise<string | null> {
    if (!this._isConnected || !this.redisClient) {
      this.logger.warn('Redis client is not connected. Cannot acquire distributed lock.');
      return null;
    }

    const queueKey = `lock:queue:${lockId}`;
    const lockKey = this.buildLockKey(lockId);
    const sessionKey = randomUUID();
    const waitStartedAt = Date.now();

    try {
      // Enqueue the session key
      await this.redisClient.lPush(queueKey, sessionKey);
      this.logger.debug(`New item joined lock queue: lockId=${lockId}, session=${sessionKey}`);

      // Poll until first in queue to acquire the lock, or until exceeding timeout
      while (Date.now() - waitStartedAt < this.lockAcquisitionTimeoutMs) {
        const firstInQueue = await this.redisClient.lIndex(queueKey, -1);

        // Check if this session is first in queue
        if (firstInQueue === sessionKey) {
          // Atomically acquire lock if available
          // set NX (set if Not eXists) new lockKey with sessionKey and PX (milliseconds) TTL
          // This ensures only one client can hold the lock at a time
          const acquired = await this.redisClient.set(lockKey, sessionKey, {
            NX: true,
            PX: this.lockTtlMs,
          });

          if (acquired) {
            // Successfully acquired lock
            const waitDurationMs = Date.now() - waitStartedAt;
            this.logger.debug(
              `Redis lock acquired: lockId=${lockId}, waited=${waitDurationMs}ms, session=${sessionKey}`,
            );
            return sessionKey;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, this.acquisitionPollIntervalMs));
      }

      // lock acquisition process timed out
      throw new Error('Lock acquisition timeout');
    } catch (error) {
      const waitDurationMs = Date.now() - waitStartedAt;
      if (error instanceof Error && error.message.includes('timeout')) {
        this.logger.warn(`Lock acquisition timeout: ${lockId}, waited ${waitDurationMs}ms, session: ${sessionKey}`);
      } else {
        this.logger.warn(`Unexpected error during lock acquisition for ${lockId} after ${waitDurationMs}ms:`, error);
      }

      // Return null to signal that the lock was not acquired, allowing other processes
      // to continue without interruption instead of being blocked by an exception.
      return null;
    } finally {
      // Remove session from queue regardless of success or failure
      // `lRem` removes the first occurrence of the session key from the queue list
      await this.redisClient.lRem(queueKey, 1, sessionKey).catch((cleanupError) => {
        this.logger.warn(`Failed to cleanup queue entry for ${lockId}:`, cleanupError);
      });
    }
  }

  /**
   * Releases a Redis-based distributed lock for the specified resource.
   *
   * Atomically validates session key using Lua script before releasing to prevent unauthorized release.
   * Silently succeeds if lock is already released.
   *
   * @param lockId - The unique identifier of the resource to release the lock for
   * @param sessionKey - The unique session key returned from acquireLock()
   * @returns Promise that resolves when the lock is released
   */
  async releaseLock(lockId: string, sessionKey: string): Promise<void> {
    if (!this._isConnected || !this.redisClient) {
      this.logger.warn(`Redis not connected. Cannot release lock for ${lockId}`);
      return;
    }

    const lockKey = this.buildLockKey(lockId);

    try {
      // Lua script for atomic lock release with session key validation.
      const REDIS_RELEASE_SCRIPT = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
    `;

      const result = await this.redisClient.eval(REDIS_RELEASE_SCRIPT, {
        keys: [lockKey],
        arguments: [sessionKey],
      });

      if (result === 1) {
        this.logger.debug(`Redis lock released: ${lockId}, session: ${sessionKey}`);
      }
    } catch (error) {
      this.logger.error(`Error releasing Redis lock for ${lockId}:`, error);
    }
  }

  /**
   * Builds the Redis lock key for a given lock ID.
   * @param lockId - The unique identifier of the resource to lock
   * @returns The Redis key used for the distributed lock
   */
  private buildLockKey(lockId: string): string {
    return `lock:${lockId.toLowerCase()}`;
  }

  /**
   * Gets the Redis connection status.
   * Returns false if Redis is not enabled, not configured, or connection failed.
   */
  get isConnected(): boolean {
    return this._isConnected;
  }
}
