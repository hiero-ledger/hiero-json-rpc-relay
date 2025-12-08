// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
import { RedisClientType } from 'redis';

import { Utils } from '../../../../utils';
import { ICacheClient } from '../ICacheClient';

/**
 * A class that provides caching functionality using Redis.
 */
export class RedisCache implements ICacheClient {
  /**
   * Prefix used to namespace all keys managed by this cache.
   *
   * @remarks
   * Using a prefix allows efficient scanning and cleanup of related keys
   * without interfering with keys from other services (e.g., pending:, hbar-limit:).
   */
  private static readonly CACHE_KEY_PREFIX = 'cache:';

  /**
   * Configurable options used when initializing the cache.
   *
   * @private
   */
  private readonly options = {
    // Max time to live in ms, for items before they are considered stale.
    ttl: ConfigService.get('CACHE_TTL'),
    multiSetEnabled: ConfigService.get('MULTI_SET'),
  };

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  protected readonly logger: Logger;

  /**
   * The Redis client.
   * @private
   */
  private readonly client: RedisClientType;

  /**
   * Creates an instance of `RedisCache`.
   *
   * @param {Logger} logger - The logger instance.
   * @param {RedisClientType} client
   */
  public constructor(logger: Logger, client: RedisClientType) {
    this.logger = logger;
    this.client = client;
  }

  /**
   * Adds the cache prefix to a key.
   *
   * @param key - The key to prefix.
   * @returns The prefixed key.
   * @private
   */
  private prefixKey(key: string): string {
    return `${RedisCache.CACHE_KEY_PREFIX}${key}`;
  }

  /**
   * Retrieves a value from the cache.
   *
   * @param key - The cache key.
   * @param callingMethod - The name of the calling method.
   * @returns The cached value or null if not found.
   */
  async get(key: string, callingMethod: string): Promise<any> {
    const prefixedKey = this.prefixKey(key);
    const result = await this.client.get(prefixedKey);
    if (result) {
      if (this.logger.isLevelEnabled('trace')) {
        const censoredKey = key.replace(Utils.IP_ADDRESS_REGEX, '<REDACTED>');
        const censoredValue = result.replace(/"ipAddress":"[^"]+"/, '"ipAddress":"<REDACTED>"');
        this.logger.trace(`Returning cached value %s:%s on %s call`, censoredKey, censoredValue, callingMethod);
      }
      // TODO: add metrics
      return JSON.parse(result);
    }
    return null;
  }

  /**
   * Stores a value in the cache.
   *
   * @param key - The cache key.
   * @param value - The value to be cached.
   * @param callingMethod - The name of the calling method.
   * @param ttl - The time-to-live (expiration) of the cache item in milliseconds.
   * @returns A Promise that resolves when the value is cached.
   */
  async set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    const serializedValue = JSON.stringify(value);
    const resolvedTtl = ttl ?? this.options.ttl; // in milliseconds
    if (resolvedTtl > 0) {
      await this.client.set(prefixedKey, serializedValue, { PX: resolvedTtl });
    } else {
      await this.client.set(prefixedKey, serializedValue);
    }

    if (this.logger.isLevelEnabled('trace')) {
      const censoredKey = key.replace(Utils.IP_ADDRESS_REGEX, '<REDACTED>');
      const censoredValue = serializedValue.replace(/"ipAddress":"[^"]+"/, '"ipAddress":"<REDACTED>"');
      const message = `Caching ${censoredKey}:${censoredValue} on ${callingMethod} for ${
        resolvedTtl > 0 ? `${resolvedTtl} ms` : 'indefinite time'
      }`;
      this.logger.trace(`%s`, message);
    }
    // TODO: add metrics
  }

  /**
   * Stores multiple key-value pairs in the cache.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @param [ttl] - The time-to-live (expiration) of the cache item in milliseconds. Used in fallback to pipelineSet.
   * @returns A Promise that resolves when the values are cached.
   */
  async multiSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    if (!this.options.multiSetEnabled) return this.pipelineSet(keyValuePairs, callingMethod, ttl);
    // Serialize values and add prefix
    const serializedKeyValuePairs: Record<string, string> = {};
    for (const [key, value] of Object.entries(keyValuePairs)) {
      const prefixedKey = this.prefixKey(key);
      serializedKeyValuePairs[prefixedKey] = JSON.stringify(value);
    }

    // Perform mSet operation
    await this.client.mSet(serializedKeyValuePairs);

    // Log the operation
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `caching multiple keys via %s, total keys: %s`,
        callingMethod,
        Object.keys(keyValuePairs).length,
      );
    }
  }

  /**
   * Stores multiple key-value pairs in the cache using pipelining.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @param [ttl] - The time-to-live (expiration) of the cache item in milliseconds.
   * @returns A Promise that resolves when the values are cached.
   */
  async pipelineSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    const resolvedTtl = ttl ?? this.options.ttl; // in milliseconds

    const pipeline = this.client.multi();

    for (const [key, value] of Object.entries(keyValuePairs)) {
      const prefixedKey = this.prefixKey(key);
      const serializedValue = JSON.stringify(value);
      pipeline.set(prefixedKey, serializedValue, { PX: resolvedTtl });
    }

    // Execute pipeline operation
    await pipeline.execAsPipeline();

    // Log the operation
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `caching multiple keys via %s, total keys: %s`,
        callingMethod,
        Object.keys(keyValuePairs).length,
      );
    }
  }

  /**
   * Deletes a value from the cache.
   *
   * @param key - The cache key.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves when the value is deleted from the cache.
   */
  async delete(key: string, callingMethod: string): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    await this.client.del(prefixedKey);
    this.logger.trace(`delete cache for %s on %s call`, key, callingMethod);
    // TODO: add metrics
  }

  /**
   * Increments a value in the cache.
   *
   * @param key The key to increment
   * @param amount The amount to increment by
   * @param callingMethod The name of the calling method
   * @returns The value of the key after incrementing
   */
  async incrBy(key: string, amount: number, callingMethod: string): Promise<number> {
    const prefixedKey = this.prefixKey(key);
    const result = await this.client.incrBy(prefixedKey, amount);
    this.logger.trace(`incrementing %s by %s on %s call`, key, amount, callingMethod);
    return result;
  }

  /**
   * Retrieves a range of elements from a list in the cache.
   *
   * @param key The key of the list
   * @param start The start index
   * @param end The end index
   * @param callingMethod The name of the calling method
   * @returns The list of elements in the range
   */
  async lRange(key: string, start: number, end: number, callingMethod: string): Promise<any[]> {
    const prefixedKey = this.prefixKey(key);
    const result = await this.client.lRange(prefixedKey, start, end);
    this.logger.trace(`retrieving range [%s:%s] from %s on %s call`, start, end, key, callingMethod);
    return result.map((item) => JSON.parse(item));
  }

  /**
   * Pushes a value to the end of a list in the cache.
   *
   * @param key The key of the list
   * @param value The value to push
   * @param callingMethod The name of the calling method
   * @returns The length of the list after pushing
   */
  async rPush(key: string, value: any, callingMethod: string): Promise<number> {
    const prefixedKey = this.prefixKey(key);
    const serializedValue = JSON.stringify(value);
    const result = await this.client.rPush(prefixedKey, serializedValue);
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`pushing %s to %s on %s call`, serializedValue, key, callingMethod);
    }
    return result;
  }

  /**
   * Retrieves all keys matching a pattern.
   * @param pattern The pattern to match
   * @param callingMethod The name of the calling method
   * @returns The list of keys matching the pattern (without the cache prefix)
   */
  async keys(pattern: string, callingMethod: string): Promise<string[]> {
    const prefixedPattern = this.prefixKey(pattern);
    const result = await this.client.keys(prefixedPattern);
    this.logger.trace(`retrieving keys matching %s on %s call`, pattern, callingMethod);
    // Remove the prefix from the returned keys
    return result.map((key) => key.substring(RedisCache.CACHE_KEY_PREFIX.length));
  }

  /**
   * Clears only the cache keys (those with cache: prefix).
   * Uses pipelining for efficient bulk deletion with UNLINK (non-blocking).
   *
   * @returns {Promise<void>} A Promise that resolves when the cache is cleared.
   */
  async clear(): Promise<void> {
    const keysToDelete = await this.client.keys(`${RedisCache.CACHE_KEY_PREFIX}*`);

    if (keysToDelete.length > 0) {
      // Use pipeline for efficient bulk deletion
      const pipeline = this.client.multi();

      for (const key of keysToDelete) {
        pipeline.unlink(key); // UNLINK is non-blocking version of DEL
      }

      await pipeline.exec();

      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`Cleared %s cache keys`, keysToDelete.length);
      }
    }
  }
}
