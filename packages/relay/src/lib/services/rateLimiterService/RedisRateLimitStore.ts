// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
import { createClient, RedisClientType } from 'redis';

import { RedisCacheError } from '../../errors/RedisCacheError';
import { IRateLimitStore } from '../../types/IRateLimitStore';

/**
 * Redis-based rate limit store implementation using Lua scripting for atomic operations.
 */
export class RedisRateLimitStore implements IRateLimitStore {
  private redisClient: RedisClientType;
  private logger: Logger;
  private connected: Promise<boolean>;

  /**
   * Lua script for atomic INCR and EXPIRE commands in Redis.
   * KEYS[1] = key (format 'ratelimit:{ip}:{method}')
   * ARGV[1] = limit (max number of requests)
   * ARGV[2] = duration (in seconds for expiration)
   * @private
   */
  private static LUA_SCRIPT = `
    local current = redis.call('INCR', KEYS[1])
    if tonumber(current) == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    if tonumber(current) > tonumber(ARGV[1]) then
      return 1
    end
    return 0
  `;

  constructor(logger: Logger) {
    this.logger = logger.child({ name: 'redisRateLimitStore' });

    const redisUrl = ConfigService.get('REDIS_URL')!;
    const reconnectDelay = ConfigService.get('REDIS_RECONNECT_DELAY_MS');

    this.redisClient = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          const delay = retries * reconnectDelay;
          this.logger.warn(`Rate limiter Redis reconnection attempt #${retries}. Delay: ${delay}ms`);
          return delay;
        },
      },
    });

    this.connected = this.redisClient
      .connect()
      .then(() => true)
      .catch((error) => {
        this.logger.error(error, 'Rate limiter Redis connection could not be established!');
        return false;
      });

    this.redisClient.on('ready', () => {
      this.connected = Promise.resolve(true);
      this.logger.info(`Rate limiter connected to Redis server successfully!`);
    });

    this.redisClient.on('end', () => {
      this.connected = Promise.resolve(false);
      this.logger.info('Rate limiter disconnected from Redis server!');
    });

    this.redisClient.on('error', (error) => {
      this.connected = Promise.resolve(false);
      const redisError = new RedisCacheError(error);
      if (redisError.isSocketClosed()) {
        this.logger.error(`Rate limiter Redis error when closing socket: ${redisError.message}`);
      } else {
        this.logger.error(`Rate limiter Redis error: ${redisError.fullError}`);
      }
    });
  }

  /**
   * Ensures the Redis client is connected before use.
   * @private
   * @returns Connected Redis client instance.
   * @throws Error if the Redis client is not connected.
   */
  private async getConnectedClient(): Promise<RedisClientType> {
    const isConnected = await this.connected;
    if (!isConnected) {
      throw new Error('Redis client is not connected');
    }
    return this.redisClient;
  }

  /**
   * Atomically increments the key in Redis and checks if the request count exceeds the limit.
   * @param key - Composite key in format 'ratelimit:{ip}:{method}'.
   * @param limit - Maximum allowed requests.
   * @param durationMs - Duration window in milliseconds for expiration.
   * @returns True if rate limit exceeded, false otherwise.
   */
  async incrementAndCheck(key: string, limit: number, durationMs: number): Promise<boolean> {
    try {
      const client = await this.getConnectedClient();
      const durationSeconds = Math.ceil(durationMs / 1000);
      const result = await client.eval(RedisRateLimitStore.LUA_SCRIPT, {
        keys: [key],
        arguments: [String(limit), String(durationSeconds)],
      });
      return result === 1;
    } catch (error) {
      this.logger.error(error, 'Redis rate limit operation failed, falling back to allow request');
      return false;
    }
  }

  /**
   * Checks if the Redis client is connected.
   */
  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  /**
   * Disconnects from Redis.
   */
  async disconnect(): Promise<void> {
    try {
      if (await this.isConnected()) {
        await this.redisClient.quit();
      }
    } catch (error) {
      this.logger.error(error, 'Error disconnecting from Redis');
    }
  }
}
