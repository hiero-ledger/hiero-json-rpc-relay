// SPDX-License-Identifier: Apache-2.0

import { Counter, Registry } from 'prom-client';

import type { ICacheClient } from './ICacheClient';

/**
 * Represents a cache client that performs the caching operations and tracks and counts all processed events.
 *
 * @implements {ICacheClient}
 */
export class MeasurableCache implements ICacheClient {
  private decoratedCacheClient: ICacheClient;
  private readonly cacheMethodsCounter: Counter;

  public static readonly methods = {
    GET: 'get',
    SET: 'set',
    DELETE: 'delete',
    MSET: 'mSet',
    PIPELINE: 'pipeline',
    INCR_BY: 'incrBy',
    RPUSH: 'rpush',
    LRANGE: 'lrange',
  };

  private cacheType: string;

  public constructor(decorated: ICacheClient, register: Registry, cacheType: string) {
    this.decoratedCacheClient = decorated;

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
    this.cacheType = cacheType;
  }

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
    return this.decoratedCacheClient.get(key, callingMethod);
  }

  /**
   * Calls the method that retrieves a cached value associated with the given key
   * and tracks how many times this event occurs.
   *
   * @param key - The key associated with the cached value.
   * @param callingMethod - The name of the method calling the cache.
   * @returns The cached value if found, otherwise null.
   */
  public async get(key: string, callingMethod: string): Promise<any> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.GET).inc(1);
    return await this.decoratedCacheClient.get(key, callingMethod);
  }

  /**
   * Calls the method that sets a value in the cache for the given key
   * and tracks how many times this event occurs.
   *
   * @param key - The key to associate with the value.
   * @param value - The value to cache.
   * @param callingMethod - The name of the method calling the cache.
   * @param ttl - Time to live for the cached value in milliseconds (optional).
   */
  public async set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.SET).inc(1);
    return await this.decoratedCacheClient.set(key, value, callingMethod, ttl);
  }

  /**
   * Calls the method that stores multiple key–value pairs in the cache
   * and tracks how many times this event occurs.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @param ttl - Time to live on the set values
   * @returns A Promise that resolves when the values are cached.
   */
  public async multiSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.MSET).inc(1);
    await this.decoratedCacheClient.multiSet(keyValuePairs, callingMethod, ttl);
  }

  /**
   * Calls the pipelineSet method that stores multiple key–value pairs in the cache
   * and tracks how many times this event occurs.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @param ttl - Time to live on the set values
   * @returns A Promise that resolves when the values are cached.
   */
  public async pipelineSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.PIPELINE).inc(1);
    await this.decoratedCacheClient.pipelineSet(keyValuePairs, callingMethod, ttl);
  }

  /**
   * Calls the method that deletes the cached value associated with the given key
   * and tracks how many times this event occurs.
   *
   * @param key - The key associated with the cached value to delete.
   * @param callingMethod - The name of the method calling the cache.
   */
  public async delete(key: string, callingMethod: string): Promise<void> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.DELETE).inc(1);
    await this.decoratedCacheClient.delete(key, callingMethod);
  }

  /**
   * Calls the method that clears the entire cache, removing all entries.
   */
  public async clear(): Promise<void> {
    await this.decoratedCacheClient.clear();
  }

  /**
   * Call the method that retrieves all keys in the cache that match the given pattern.
   *
   * @param pattern - The pattern to match keys against.
   * @param callingMethod - The name of the method calling the cache.
   * @returns An array of keys that match the pattern (without the cache prefix).
   */
  public async keys(pattern: string, callingMethod: string): Promise<string[]> {
    return await this.decoratedCacheClient.keys(pattern, callingMethod);
  }

  /**
   * Calls the method that increments a cached value and tracks how many times this event occurs.
   *
   * @param key The key to increment
   * @param amount The amount to increment by
   * @param callingMethod The name of the calling method
   * @returns The value of the key after incrementing
   */
  public async incrBy(key: string, amount: number, callingMethod: string): Promise<number> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.INCR_BY).inc(1);
    return await this.decoratedCacheClient.incrBy(key, amount, callingMethod);
  }

  /**
   * Calls the method that retrieves a range of elements from a list in the cache
   * and tracks how many times this event occurs.
   *
   * @param key The key of the list
   * @param start The start index
   * @param end The end index
   * @param callingMethod The name of the calling method
   * @returns The list of elements in the range
   */
  public async lRange(key: string, start: number, end: number, callingMethod: string): Promise<any[]> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.LRANGE).inc(1);
    return await this.decoratedCacheClient.lRange(key, start, end, callingMethod);
  }

  /**
   * Calls the method that pushes a value to the end of a list in the cache
   * and tracks how many times this event occurs.
   *
   * @param key The key of the list
   * @param value The value to push
   * @param callingMethod The name of the calling method
   * @returns The length of the list after pushing
   */
  public async rPush(key: string, value: any, callingMethod: string): Promise<number> {
    this.cacheMethodsCounter.labels(callingMethod, this.cacheType, MeasurableCache.methods.RPUSH).inc(1);
    return await this.decoratedCacheClient.rPush(key, value, callingMethod);
  }
}
