// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';

import { Utils } from '../../../utils';
import { ICacheClient } from './ICacheClient';

type LRUCacheOptions = LRUCache.OptionsMaxLimit<string, any, unknown> & LRUCache.OptionsTTLLimit<string, any, unknown>;

/**
 * Represents a LocalLRUCache instance that uses an LRU (Least Recently Used) caching strategy
 * for caching items internally from requests.
 * @implements {ICacheClient}
 */
export class LocalLRUCache implements ICacheClient {
  private static readonly CACHE_KEY_PREFIX = 'cache:';

  /**
   * Configurable options used when initializing the cache.
   *
   * @private
   */
  private readonly options: LRUCacheOptions = {
    // The maximum number (or size) of items that remain in the cache (assuming no TTL pruning or explicit deletions).
    max: ConfigService.get('CACHE_MAX'),
    // Max time to live in ms, for items before they are considered stale.
    ttl: ConfigService.get('CACHE_TTL'),
    // Disable the preemptively removing stale items from the cache
    ttlAutopurge: false,
  };

  /**
   * The LRU cache used for caching items from requests.
   *
   * @private
   */
  private readonly cache: LRUCache<string, any>;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * The gauge used for tracking the size of the cache.
   * @private
   */
  private readonly cacheKeyGauge: Gauge<string>;

  /**
   * A set of keys that should never be evicted from the cache.
   * @private
   */
  private readonly reservedKeys: Set<string>;

  /**
   * The LRU cache used for caching items from requests that should never be evicted.
   *
   * @private
   */
  private readonly reservedCache?: LRUCache<string, any>;

  /**
   * Represents a LocalLRUCache instance that uses an LRU (Least Recently Used) caching strategy
   * for caching items internally from requests.
   * @implements {ICacheClient}
   * @class
   * @constructor
   * @param {Logger} logger - The logger instance to be used for logging.
   * @param {Registry} register - The registry instance used for metrics tracking.
   * @param {Set<string>} reservedKeys - These are the cache keys delegated to the reserved cache.
   */
  public constructor(logger: Logger, register: Registry, reservedKeys: Set<string> = new Set()) {
    this.cache = new LRUCache(this.options);
    this.logger = logger;
    this.reservedKeys = reservedKeys;
    if (reservedKeys.size > 0) {
      this.reservedCache = new LRUCache({ max: reservedKeys.size });
    }

    const cacheSizeCollect = (): void => {
      this.purgeStale();
      this.cacheKeyGauge.set(this.cache.size);
    };

    const metricCounterName = 'rpc_relay_cache';
    register.removeSingleMetric(metricCounterName);
    this.cacheKeyGauge = new Gauge({
      name: metricCounterName,
      help: 'Relay LRU cache gauge',
      registers: [register],
      async collect(): Promise<void> {
        cacheSizeCollect();
      },
    });
  }

  /**
   * Adds the cache prefix to a key.
   *
   * @param key - The key to prefix.
   * @returns The prefixed key.
   * @private
   */
  private prefixKey(key: string): string {
    return `${LocalLRUCache.CACHE_KEY_PREFIX}${key}`;
  }

  /**
   * Retrieves a cached value associated with the given key.
   * If the value exists in the cache, updates metrics and logs the retrieval.
   * @param key - The key associated with the cached value.
   * @param callingMethod - The name of the method calling the cache.
   * @returns The cached value if found, otherwise null.
   */
  public async get(key: string, callingMethod: string): Promise<any> {
    const prefixedKey = this.prefixKey(key);
    const cache = this.getCacheInstance(key);
    const value = cache.get(prefixedKey);
    if (value !== undefined) {
      if (this.logger.isLevelEnabled('trace')) {
        const censoredKey = key.replace(Utils.IP_ADDRESS_REGEX, '<REDACTED>');
        const censoredValue = JSON.stringify(value).replace(/"ipAddress":"[^"]+"/, '"ipAddress":"<REDACTED>"');
        this.logger.trace('Returning cached value %s:%s on %s call', censoredKey, censoredValue, callingMethod);
      }
      return value;
    }

    return null;
  }

  /**
   * The remaining TTL of the specified key in the cache.
   * @param key - The key to check the remaining TTL for.
   * @param callingMethod - The name of the method calling the cache.
   * @returns The remaining TTL in milliseconds.
   * @private
   */
  private async getRemainingTtl(key: string, callingMethod: string): Promise<number> {
    const prefixedKey = this.prefixKey(key);
    const cache = this.getCacheInstance(key);
    const remainingTtl = cache.getRemainingTTL(prefixedKey); // in milliseconds
    this.logger.trace(`returning remaining TTL %s:%s on %s call`, key, remainingTtl, callingMethod);

    return remainingTtl;
  }

  /**
   * Sets a value in the cache associated with the given key.
   * Updates metrics, logs the caching, and associates a TTL if provided.
   * @param key - The key to associate with the value.
   * @param value - The value to cache.
   * @param callingMethod - The name of the method calling the cache.
   * @param ttl - Time to live for the cached value in milliseconds (optional).
   */
  public async set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    const resolvedTtl = ttl ?? this.options.ttl;
    const cache = this.getCacheInstance(key);
    if (resolvedTtl > 0) {
      cache.set(prefixedKey, value, { ttl: resolvedTtl });
    } else {
      cache.set(prefixedKey, value, { ttl: 0 }); // 0 means indefinite time
    }
    if (this.logger.isLevelEnabled('trace')) {
      const censoredKey = key.replace(Utils.IP_ADDRESS_REGEX, '<REDACTED>');
      const censoredValue = JSON.stringify(value).replace(/"ipAddress":"[^"]+"/, '"ipAddress":"<REDACTED>"');
      const message = `Caching ${censoredKey}:${censoredValue} on ${callingMethod} for ${
        resolvedTtl > 0 ? `${resolvedTtl} ms` : 'indefinite time'
      }`;
      this.logger.trace(`%s (cache size: %s, max: %s)`, message, this.cache.size, this.options.max);
    }
  }

  /**
   * Stores multiple key-value pairs in the cache.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves when the values are cached.
   */
  public async multiSet(keyValuePairs: Record<string, any>, callingMethod: string): Promise<void> {
    // Iterate over each entry in the keyValuePairs object
    for (const [key, value] of Object.entries(keyValuePairs)) {
      await this.set(key, value, callingMethod);
    }
  }

  /**
   * Stores multiple key-value pairs in the cache.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @param ttl - Time to live on the set values
   * @returns A Promise that resolves when the values are cached.
   */
  public async pipelineSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    // Iterate over each entry in the keyValuePairs object
    for (const [key, value] of Object.entries(keyValuePairs)) {
      await this.set(key, value, callingMethod, ttl);
    }
  }

  /**
   * Deletes a cached value associated with the given key.
   * Logs the deletion of the cache entry.
   * @param key - The key associated with the cached value to delete.
   * @param callingMethod - The name of the method calling the cache.
   */
  public async delete(key: string, callingMethod: string): Promise<void> {
    const prefixedKey = this.prefixKey(key);

    this.logger.trace(`delete cache for %s on %s call`, key, callingMethod);

    const cache = this.getCacheInstance(key);
    cache.delete(prefixedKey);
  }

  /**
   * Purges stale entries from the cache.
   * This method should be called periodically to remove items that have expired.
   */
  public purgeStale(): void {
    this.cache.purgeStale();
  }

  /**
   * Clears the entire cache, removing all entries.
   * Use this method with caution, as it wipes all cached data.
   */
  public async clear(): Promise<void> {
    this.cache.clear();
    this.reservedCache?.clear();
  }

  /**
   * Retrieves all keys in the cache that match the given pattern.
   * @param pattern - The pattern to match keys against.
   * @param callingMethod - The name of the method calling the cache.
   * @returns An array of keys that match the pattern (without the cache prefix).
   */
  public async keys(pattern: string, callingMethod: string): Promise<string[]> {
    const keys = [...this.cache.rkeys(), ...(this.reservedCache?.rkeys() ?? [])];

    const prefixedPattern = this.prefixKey(pattern);

    // Replace escaped special characters with placeholders
    let regexPattern = prefixedPattern
      .replace(/\\\*/g, '__ESCAPED_STAR__')
      .replace(/\\\?/g, '__ESCAPED_QUESTION__')
      .replace(/\\\[/g, '__ESCAPED_OPEN_BRACKET__')
      .replace(/\\]/g, '__ESCAPED_CLOSE_BRACKET__');

    // Replace unescaped special characters with regex equivalents
    regexPattern = regexPattern
      .replace(/\\([*?[\]])/g, (_, char) => `__ESCAPED_${char}__`)
      .replace(/\[([^\]\\]+)]/g, '[$1]')
      .replace(/(?<!\\)\*/g, '.*')
      .replace(/(?<!\\)\?/g, '.')
      .replace(/(?<!\\)\[!]/g, '[^]');

    // Replace placeholders with the original special characters
    regexPattern = regexPattern
      .replace(/__ESCAPED_STAR__/g, '\\*')
      .replace(/__ESCAPED_QUESTION__/g, '\\?')
      .replace(/__ESCAPED_OPEN_BRACKET__/g, '\\[')
      .replace(/__ESCAPED_CLOSE_BRACKET__/g, '\\]');

    const regex = new RegExp(regexPattern);

    const matchingKeys = keys.filter((key) => regex.test(key));

    this.logger.trace(`retrieving keys matching %s on %s call`, pattern, callingMethod);

    // Remove the prefix from the returned keys
    return matchingKeys.map((key) => key.substring(LocalLRUCache.CACHE_KEY_PREFIX.length));
  }

  /**
   * Increments a value in the cache.
   *
   * @param key The key to increment
   * @param amount The amount to increment by
   * @param callingMethod The name of the calling method
   * @returns The value of the key after incrementing
   */
  public async incrBy(key: string, amount: number, callingMethod: string): Promise<number> {
    const value = await this.get(key, callingMethod);
    const newValue = value + amount;
    const remainingTtl = await this.getRemainingTtl(key, callingMethod);
    await this.set(key, newValue, callingMethod, remainingTtl);
    return newValue;
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
  public async lRange(key: string, start: number, end: number, callingMethod: string): Promise<any[]> {
    const values = (await this.get(key, callingMethod)) ?? [];
    if (!Array.isArray(values)) {
      throw new Error(`Value at key ${key} is not an array`);
    }
    if (end < 0) {
      end = values.length + end;
    }
    return values.slice(start, end + 1);
  }

  /**
   * Pushes a value to the end of a list in the cache.
   *
   * @param key The key of the list
   * @param value The value to push
   * @param callingMethod The name of the calling method
   * @returns The length of the list after pushing
   */
  public async rPush(key: string, value: any, callingMethod: string): Promise<number> {
    const values = (await this.get(key, callingMethod)) ?? [];
    if (!Array.isArray(values)) {
      throw new Error(`Value at key ${key} is not an array`);
    }
    values.push(value);
    const remainingTtl = await this.getRemainingTtl(key, callingMethod);
    await this.set(key, values, callingMethod, remainingTtl);
    return values.length;
  }

  /**
   * Returns the appropriate cache instance for the given key.
   * If a reserved cache exists and the key is marked as reserved,
   * the reserved cache is returned; otherwise the default cache is used.
   *
   * @param key -  The cache key being accessed.
   * @returns The selected cache instance
   * @private
   */
  private getCacheInstance(key: string): LRUCache<string, any> {
    return this.reservedCache && this.reservedKeys.has(key) ? this.reservedCache : this.cache;
  }
}
