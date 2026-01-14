// SPDX-License-Identifier: Apache-2.0

import { Counter, Registry } from 'prom-client';

import { WorkersPool } from '../../services/workersService/WorkersPool';
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

  public static ADD_LABEL_TO_CACHE_METHODS_COUNTER = 'addLabelToCacheMethodsCounter';

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
    this.addLabelToCacheMethodsCounter(callingMethod, this.cacheType, MeasurableCache.methods.GET);
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
    this.addLabelToCacheMethodsCounter(callingMethod, this.cacheType, MeasurableCache.methods.SET);
    return await this.decoratedCacheClient.set(key, value, callingMethod, ttl);
  }

  /**
   * Calls the method that deletes the cached value associated with the given key
   * and tracks how many times this event occurs.
   *
   * @param key - The key associated with the cached value to delete.
   * @param callingMethod - The name of the method calling the cache.
   */
  public async delete(key: string, callingMethod: string): Promise<void> {
    this.addLabelToCacheMethodsCounter(callingMethod, this.cacheType, MeasurableCache.methods.DELETE);
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
    this.addLabelToCacheMethodsCounter(callingMethod, this.cacheType, MeasurableCache.methods.INCR_BY);
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
    this.addLabelToCacheMethodsCounter(callingMethod, this.cacheType, MeasurableCache.methods.LRANGE);
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
    this.addLabelToCacheMethodsCounter(callingMethod, this.cacheType, MeasurableCache.methods.RPUSH);
    return await this.decoratedCacheClient.rPush(key, value, callingMethod);
  }

  /**
   * Increments the cache methods counter metric with the given label values. This method updates the local
   * `cacheMethodsCounter` metric and, if enabled, forwards the same update to the parent thread via `parentPort`.
   *
   * @param callingMethod - Name of the method initiating the cache operation.
   * @param cacheType - Type of cache being accessed (e.g., lru, redis).
   * @param method - Cache operation performed (e.g., get, set, delete).
   */
  public addLabelToCacheMethodsCounter(callingMethod: string, cacheType: string, method: string): void {
    WorkersPool.updateMetricViaWorkerOrLocal(
      MeasurableCache.ADD_LABEL_TO_CACHE_METHODS_COUNTER,
      {
        callingMethod,
        cacheType,
        method,
      },
      () => this.cacheMethodsCounter.labels(callingMethod, cacheType, method).inc(1),
    );
  }
}
