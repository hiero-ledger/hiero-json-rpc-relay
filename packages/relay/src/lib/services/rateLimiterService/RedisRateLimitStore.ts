// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
import { Counter } from 'prom-client';
import { createClient, RedisClientType } from 'redis';

import { RedisCacheError } from '../../errors/RedisCacheError';
import { RateLimitKey, RateLimitStore } from '../../types';
import { RequestDetails } from '../../types/RequestDetails';

/**
 * Redis-based rate limit store implementation using Lua scripting for atomic operations.
 * Implements both RateLimitStore for core functionality
 */
export class RedisRateLimitStore implements RateLimitStore {
  private redisClient: RedisClientType;
  private logger: Logger;
  private connected: Promise<boolean>;
  private rateLimitStoreFailureCounter?: Counter;
  private readonly duration: number;

  /**
   * Lua script for atomic INCR and EXPIRE commands in Redis.
   * This script is responsible for incrementing the request count for a given key and setting an expiration time.
   *
   * - `KEYS[1]`: The key in the format 'ratelimit:{ip}:{method}' representing the rate limit context.
   * - `ARGV[1]`: The limit, which is the maximum number of requests allowed.
   * - `ARGV[2]`: The duration in seconds for which the key should be valid (expiration time).
   *
   * The script performs the following operations:
   * 1. Increments the request count for the given key using `INCR`.
   * 2. If the incremented count is 1, it sets the expiration time using `EXPIRE`.
   * 3. If the incremented count exceeds the limit, it returns 1 (indicating the rate limit is exceeded).
   * 4. Otherwise, it returns 0 (indicating the rate limit is not exceeded).
   *
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

  constructor(logger: Logger, duration: number, rateLimitStoreFailureCounter?: Counter) {
    this.logger = logger.child({ name: 'redis-rate-limit-store' });
    this.duration = duration;
    this.rateLimitStoreFailureCounter = rateLimitStoreFailureCounter;

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
   * @param key - The rate limit key containing IP and method information.
   * @param limit - Maximum allowed requests.
   * @param requestDetails - Request details for logging and tracing.
   * @returns True if rate limit exceeded, false otherwise.
   */
  async incrementAndCheck(key: RateLimitKey, limit: number, requestDetails: RequestDetails): Promise<boolean> {
    try {
      const client = await this.getConnectedClient();
      const durationSeconds = Math.ceil(this.duration / 1000);
      const result = await client.eval(RedisRateLimitStore.LUA_SCRIPT, {
        keys: [key.toString()],
        arguments: [String(limit), String(durationSeconds)],
      });
      return result === 1;
    } catch (error) {
      if (this.rateLimitStoreFailureCounter) {
        this.rateLimitStoreFailureCounter.labels('Redis', key.method).inc();
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${requestDetails.formattedRequestId}Rate limit store operation failed for IP address method for method ${key.method}. Error: ${errorMessage}. Allowing request to proceed (fail-open behavior).`,
        error,
      );

      // Fail open: allow the request to proceed if rate limiting fails
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
