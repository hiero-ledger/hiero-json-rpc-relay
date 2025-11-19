// SPDX-License-Identifier: Apache-2.0

import { Counter } from 'prom-client';

import { ICacheClient } from './ICacheClient';

/**
 * Represents a cache client that performs the caching operations and tracks and counts all processed events.
 *
 * @implements {ICacheClient}
 */
export class MeasurableCache implements ICacheClient {
  private decorated: ICacheClient;
  private readonly cacheMethodsCounter: Counter;

  public static readonly methods = {
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

  private cacheType: string;
  private callMap: Map<string, string[]>;

  public constructor(
    decorated: ICacheClient,
    cacheMethodsCounter: Counter,
    cacheType: string,
    callMap: Map<string, string[]>,
  ) {
    this.decorated = decorated;
    this.cacheMethodsCounter = cacheMethodsCounter;
    this.cacheType = cacheType;
    this.callMap = callMap;
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
    return this.decorated.get(key, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.GET_ASYNC);
    return await this.decorated.get(key, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.SET);
    return await this.decorated.set(key, value, callingMethod, ttl);
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
    await this.decorated.multiSet(keyValuePairs, callingMethod, ttl);
    this.count(callingMethod, MeasurableCache.methods.MSET);
  }

  /**
   * Calls the method that deletes the cached value associated with the given key
   * and tracks how many times this event occurs.
   *
   * @param key - The key associated with the cached value to delete.
   * @param callingMethod - The name of the method calling the cache.
   */
  public async delete(key: string, callingMethod: string): Promise<void> {
    this.count(callingMethod, MeasurableCache.methods.DELETE);
    await this.decorated.delete(key, callingMethod);
  }

  /**
   * Calls the method that clears the entire cache, removing all entries.
   */
  public async clear(): Promise<void> {
    await this.decorated.clear();
  }

  /**
   * Call the method that retrieves all keys in the cache that match the given pattern.
   *
   * @param pattern - The pattern to match keys against.
   * @param callingMethod - The name of the method calling the cache.
   * @returns An array of keys that match the pattern (without the cache prefix).
   */
  public async keys(pattern: string, callingMethod: string): Promise<string[]> {
    return await this.decorated.keys(pattern, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.INCR_BY);
    return await this.decorated.incrBy(key, amount, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.LRANGE);
    return await this.decorated.lRange(key, start, end, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.RPUSH);
    return await this.decorated.rPush(key, value, callingMethod);
  }

  /**
   * Counts the number of occurrences of the given caching related operation.
   * Depending on the underlying client implementation, the actual caching behavior may vary.
   * The `callMap` allows us to account for these differences when counting occurrences.
   *
   * For example, if the underlying cache mechanism (such as LRU) does not provide an lRange method,
   * we can implement it ourselves by using get and set instead. We want to count each lRange call
   * as corresponding get and set calls then.
   *
   * @param caller The name of the calling method
   * @param callee Actual caching operation
   * @private
   */
  private count(caller: string, callee: string): void {
    (this.callMap.get(callee) || [callee]).forEach((value: string) =>
      this.cacheMethodsCounter.labels(caller, this.cacheType, value).inc(1),
    );
  }
}
