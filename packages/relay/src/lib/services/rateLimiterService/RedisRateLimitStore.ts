// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';
import { Counter } from 'prom-client';
import { RedisClientType } from 'redis';

import { RateLimitKey, RateLimitStore } from '../../types';

/**
 * Redis-based rate limit store implementation using Lua scripting for atomic operations.
 * Implements RateLimitStore for core functionality.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly logger: Logger;
  private readonly rateLimitStoreFailureCounter?: Counter;
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

  /**
   * Creates a Redis-backed rate limit store.
   *
   * @param redisClient - A connected Redis client instance.
   * @param logger - Logger instance for logging.
   * @param duration - Time window in milliseconds for rate limiting.
   * @param rateLimitStoreFailureCounter - Optional counter for tracking store failures.
   */
  constructor(
    private readonly redisClient: RedisClientType,
    logger: Logger,
    duration: number,
    rateLimitStoreFailureCounter?: Counter,
  ) {
    this.logger = logger.child({ name: 'redis-rate-limit-store' });
    this.duration = duration;
    this.rateLimitStoreFailureCounter = rateLimitStoreFailureCounter;
  }

  /**
   * Atomically increments the key in Redis and checks if the request count exceeds the limit.
   * @param key - The rate limit key containing IP and method information.
   * @param limit - Maximum allowed requests.
   * @returns True if rate limit exceeded, false otherwise.
   */
  async incrementAndCheck(key: RateLimitKey, limit: number): Promise<boolean> {
    try {
      const durationSeconds = Math.ceil(this.duration / 1000);
      const result = await this.redisClient.eval(RedisRateLimitStore.LUA_SCRIPT, {
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
          error,
          `Rate limit store operation failed for IP address method for method %s. Error: %s. Allowing request to proceed (fail-open behavior).`,
          key.method,
          errorMessage,
      );

      // Fail open: allow the request to proceed if rate limiting fails
      return false;
    }
  }
}
