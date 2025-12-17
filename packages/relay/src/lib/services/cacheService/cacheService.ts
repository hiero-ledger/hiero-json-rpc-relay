// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Counter, Registry } from 'prom-client';

import { RedisCache } from '../../clients';
import { ICacheClient } from '../../clients/cache/ICacheClient';
import { RegistryFactory } from '../../factories/registryFactory';

/**
 * A service that manages caching using different cache implementations based on configuration.
 */
export class CacheService {
  /**
   * The cache used for caching items from requests.
   *
   * @private
   */
  private readonly client: ICacheClient;

  /**
   * Used for reference to the state of REDIS_ENABLED and REDIS_URL env. variables.
   */
  private readonly isSharedCacheEnabled: boolean;

  /**
   * Used for setting what type of multiSet method should be used to save new values.
   */
  private readonly shouldMultiSet: boolean;

  /**
   * Represents a caching manager that utilizes various cache implementations based on configuration.
   * @param {Logger} logger - The logger used for logging all output from this class.
   * @param {Registry} register - The metrics register used for metrics tracking.
   */

  private static readonly cacheTypes = {
    REDIS: 'redis',
    LRU: 'lru',
  };

  private static readonly methods = {
    GET: 'get',
    GET_ASYNC: 'getAsync',
    SET: 'set',
    DELETE: 'delete',
    MSET: 'mSet',
    PIPELINE: 'pipeline',
    INCR_BY: 'incrBy',
    RPUSH: 'rpush',
    LRANGE: 'lrange',
  };

  private readonly cacheMethodsCounter: Counter;

  public constructor(client: ICacheClient, register: Registry = RegistryFactory.getInstance()) {
    this.client = client;
    this.isSharedCacheEnabled = client instanceof RedisCache; // TODO measurements will be moved out of here in the next PR.
    this.shouldMultiSet = ConfigService.get('MULTI_SET'); // TODO measurements will be moved out of here in the next PR.
    /**
     * Labels:
     *  callingMethod - The method initiating the cache operation
     *  cacheType - redis/lru
     *  method - The CacheService method being called
     */
    const metricName = 'rpc_cache_service_methods_counter';
    register.removeSingleMetric(metricName);
    this.cacheMethodsCounter = new Counter({
      name: metricName,
      help: 'Counter for calls to methods of CacheService separated by CallingMethod and CacheType',
      registers: [register],
      labelNames: ['callingMethod', 'cacheType', 'method'],
    });
  }

  /**
   * Retrieves a value from the cache asynchronously.
   *
   * @param key - The cache key.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves with the cached value or null if not found.
   */
  private async getFromSharedCache(key: string, callingMethod: string): Promise<any> {
    this.cacheMethodsCounter
      .labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.GET_ASYNC)
      .inc(1);

    return await this.client.get(key, callingMethod);
  }

  /**
   * If SharedCacheEnabled will use shared, otherwise will fallback to internal cache.
   * @param key - The cache key.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves with the cached value or null if not found.
   * @template T - The type of the cached value.
   */
  public async getAsync<T = any>(key: string, callingMethod: string): Promise<T> {
    if (this.isSharedCacheEnabled) {
      return await this.getFromSharedCache(key, callingMethod);
    } else {
      return await this.getFromInternalCache(key, callingMethod);
    }
  }

  /**
   * Retrieves a value from the internal cache.
   *
   * @param key - The cache key.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves with the cached value or null if not found.
   */
  private async getFromInternalCache(key: string, callingMethod: string): Promise<any> {
    this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.GET).inc(1);

    return await this.client.get(key, callingMethod);
  }

  /**
   * Sets a value in the cache associated with the given key.
   *
   * @param key - The key to associate with the value.
   * @param value - The value to cache.
   * @param callingMethod - The name of the method calling the cache.
   * @param ttl - Time to live for the cached value in milliseconds (optional).
   */
  public async set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void> {
    if (this.isSharedCacheEnabled) {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.SET).inc(1);
    } else {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
    }
    await this.client.set(key, value, callingMethod, ttl);
  }

  /**
   * Sets multiple values in the cache, each associated with its respective key.
   * @param entries - An object containing key-value pairs to cache.
   * @param callingMethod - The name of the method calling the cache.
   * @param ttl - Time to live for the cached value in milliseconds (optional).
   */
  public async multiSet(entries: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    await this.client.multiSet(entries, callingMethod, ttl);
    if (this.isSharedCacheEnabled) {
      const metricsMethod = this.shouldMultiSet ? CacheService.methods.MSET : CacheService.methods.PIPELINE;
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.REDIS, metricsMethod).inc(1);
    } else {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
    }
  }

  /**
   * Deletes a cached value associated with the given key.
   * If the shared cache is enabled and an error occurs while deleting from it, just logs the error.
   * Else the internal cache deletion is attempted.
   * @param key - The key associated with the cached value to delete.
   * @param callingMethod - The name of the method calling the cache.
   */
  public async delete(key: string, callingMethod: string): Promise<void> {
    if (this.isSharedCacheEnabled) {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.DELETE).inc(1);
    } else {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.DELETE).inc(1);
    }
    await this.client.delete(key, callingMethod);
  }

  /**
   * Clears the cache.
   * If the shared cache is enabled and an error occurs while clearing it, just logs the error.
   * Else the internal cache clearing is attempted.
   */
  public async clear(): Promise<void> {
    await this.client.clear();
  }

  /**
   * Increments the value of a key in the cache by the specified amount.
   * @param key - The key to increment.
   * @param amount - The amount to increment by.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves with the new value of the key after incrementing.
   */
  public async incrBy(key: string, amount: number, callingMethod: string): Promise<number> {
    if (this.isSharedCacheEnabled) {
      this.cacheMethodsCounter
        .labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.INCR_BY)
        .inc(1);
    } else {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.GET).inc(1);
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
    }

    return await this.client.incrBy(key, amount, callingMethod);
  }

  /**
   * Pushes a value to the end of a list in the cache.
   * @param key - The key of the list.
   * @param value - The value to push.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves with the new length of the list after pushing.
   */
  public async rPush(key: string, value: any, callingMethod: string): Promise<number> {
    if (this.isSharedCacheEnabled) {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.RPUSH).inc(1);
    } else {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.GET).inc(1);
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
    }

    return await this.client.rPush(key, value, callingMethod);
  }

  /**
   * Retrieves a range of values from a list in the cache.
   * @param key - The key of the list.
   * @param start - The start index of the range.
   * @param end - The end index of the range.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves with the values in the range.
   * @template T - The type of the values in the list.
   */
  public async lRange<T = any>(key: string, start: number, end: number, callingMethod: string): Promise<T[]> {
    if (this.isSharedCacheEnabled) {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.LRANGE).inc(1);
    } else {
      this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.GET).inc(1);
    }
    return await this.client.lRange(key, start, end, callingMethod);
  }

  /**
   * Retrieves all keys matching the given pattern.
   * @param pattern - The pattern to match keys against.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves with an array of keys that match the pattern.
   */
  async keys(pattern: string, callingMethod: string): Promise<string[]> {
    return await this.client.keys(pattern, callingMethod);
  }
}
