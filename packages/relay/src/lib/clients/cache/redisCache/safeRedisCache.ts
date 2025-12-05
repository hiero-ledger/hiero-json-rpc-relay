// SPDX-License-Identifier: Apache-2.0

import { RedisCacheError } from '../../../errors/RedisCacheError';
import { RedisCache } from './redisCache';

/**
 * A safer wrapper around {@link RedisCache} which is responsible for:
 *  - ignoring all Redis command errors.
 *  - logging all errors,
 *  - returning default values in cases of failures.
 *
 * Thanks to that our application will be able to continue functioning even with Redis being down...
 */
export class SafeRedisCache extends RedisCache {
  /**
   * Alias for the `get` method.
   *
   * @param key - The key associated with the cached value.
   * @param callingMethod - The name of the method calling the cache.
   * @returns The cached value if found, otherwise null.
   *
   * @deprecated use `get` instead.
   */
  public getAsync(key: string, callingMethod: string): Promise<any> {
    return this.get(key, callingMethod);
  }

  /**
   * Retrieves a value from the cache.
   *
   * This method wraps {@link RedisCache.get} and ensures `null` is returned instead of throwing error.
   *
   * @param key - The cache key.
   * @param callingMethod - Name of the method making the request (for logging).
   * @returns The cached value, or `null` if Redis fails or the value does not exist.
   */
  async get(key: string, callingMethod: string): Promise<any> {
    return await this.safeCall(() => super.get(key, callingMethod), null);
  }

  /**
   /**
   * Stores a value in the cache safely.
   *
   * Wraps {@link RedisCache.set} and suppresses Redis errors.
   * On failure, nothing is thrown and the error is logged.
   *
   * @param key - The cache key.
   * @param value - The value to store.
   * @param callingMethod - Name of the calling method.
   * @param ttl - Optional TTL in milliseconds.
   */
  async set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void> {
    await this.safeCall(() => super.set(key, value, callingMethod, ttl), undefined);
  }

  /**
   * Stores multiple key-value pairs safely.
   *
   * Wraps {@link RedisCache.multiSet} with error suppression.
   *
   * @param keyValuePairs - Object of key-value pairs to set.
   * @param callingMethod - Name of the calling method.
   * @param ttl - Optional TTL used in fallback pipeline mode.
   */
  async multiSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    await this.safeCall(() => super.multiSet(keyValuePairs, callingMethod, ttl), undefined);
  }

  /**
   * Performs a pipelined multi-set operation safely.
   *
   * Wraps {@link RedisCache.pipelineSet} with error suppression.
   *
   * @param keyValuePairs - Key-value pairs to write.
   * @param callingMethod - Name of the calling method.
   * @param ttl - Optional TTL.
   */
  async pipelineSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    await this.safeCall(() => super.pipelineSet(keyValuePairs, callingMethod, ttl), undefined);
  }

  /**
   * Deletes a value from the cache safely.
   *
   * Wraps {@link RedisCache.delete} with error suppression.
   *
   * @param key - Key to delete.
   * @param callingMethod - Name of the calling method.
   */
  async delete(key: string, callingMethod: string): Promise<void> {
    await this.safeCall(() => super.delete(key, callingMethod), undefined);
  }

  /**
   * Increments a numeric value safely.
   *
   * Wraps {@link RedisCache.incrBy}.
   * On failure, returns the `amount` argument as fallback.
   *
   * @param key - Key to increment.
   * @param amount - Increment amount.
   * @param callingMethod - Name of the calling method.
   * @returns The incremented value or the fallback (amount) if Redis fails.
   */
  async incrBy(key: string, amount: number, callingMethod: string): Promise<number> {
    return await this.safeCall(() => super.incrBy(key, amount, callingMethod), amount);
  }

  /**
   * Retrieves a list slice safely.
   *
   * Wraps {@link RedisCache.lRange}.
   * On error, returns an empty array.
   *
   * @param key - List key.
   * @param start - Start index.
   * @param end - End index.
   * @param callingMethod - Name of the calling method.
   * @returns List of elements, or an empty array on failure.
   */
  async lRange(key: string, start: number, end: number, callingMethod: string): Promise<any[]> {
    return await this.safeCall(() => super.lRange(key, start, end, callingMethod), []);
  }

  /**
   * Pushes a value to a list safely.
   *
   * Wraps {@link RedisCache.rPush}.
   * Returns `0` on failure.
   *
   * @param key - List key.
   * @param value - Value to push.
   * @param callingMethod - Name of the calling method.
   * @returns The new list length, or `0` if Redis fails.
   */
  async rPush(key: string, value: any, callingMethod: string): Promise<number> {
    return await this.safeCall(() => super.rPush(key, value, callingMethod), 0);
  }

  /**
   * Retrieves keys matching a pattern safely.
   *
   * Wraps {@link RedisCache.keys}.
   * Returns an empty array on error.
   *
   * @param pattern - Match pattern.
   * @param callingMethod - Name of the calling method.
   * @returns Array of matched keys (prefix removed), or empty array on error.
   */
  async keys(pattern: string, callingMethod: string): Promise<string[]> {
    return await this.safeCall(() => super.keys(pattern, callingMethod), []);
  }

  /**
   * Clears all cache keys safely.
   *
   * Wraps {@link RedisCache.clear}.
   * Any Redis failure is logged and ignored.
   */

  async clear(): Promise<void> {
    await this.safeCall(() => super.clear(), null);
  }

  /**
   * Executes a Redis call safely.
   *
   * This is the core safety mechanism of {@link SafeRedisCache}.
   *
   * @template T The expected return type.
   * @param fn - Function containing the Redis call.
   * @param fallback - Value to return if an error occurs.
   * @returns The result of `fn()` or the fallback.
   */
  async safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const redisError = new RedisCacheError(error);
      this.logger.error(redisError, 'Error occurred while getting the cache from Redis.');
      return fallback;
    }
  }
}
