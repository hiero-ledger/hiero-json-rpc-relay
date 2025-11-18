// SPDX-License-Identifier: Apache-2.0

import { Counter } from 'prom-client';

import { ICacheClient } from './ICacheClient';

/**
 * Represents a LocalLRUCache instance that uses an LRU (Least Recently Used) caching strategy
 * for caching items internally from requests.
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
   * Retrieves a cached value associated with the given key.
   * If the value exists in the cache, updates metrics and logs the retrieval.
   * @param key - The key associated with the cached value.
   * @param callingMethod - The name of the method calling the cache.
   * @returns The cached value if found, otherwise null.
   */
  public async getAsync(key: string, callingMethod: string): Promise<any> {
    this.count(callingMethod, MeasurableCache.methods.GET_ASYNC);
    return await this.decorated.getAsync(key, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.SET);
    return await this.decorated.set(key, value, callingMethod, ttl);
  }

  /**
   * Stores multiple key-value pairs in the cache.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @param ttl - Time to live on the set values
   * @returns A Promise that resolves when the values are cached.
   */
  public async multiSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number): Promise<void> {
    await this.decorated.multiSet(keyValuePairs, callingMethod, ttl);
    this.count(callingMethod, MeasurableCache.methods.MSET); // FIXME  SET in lru and MULTISET/PIPELINESET in redis
  }

  /**
   * Deletes a cached value associated with the given key.
   * Logs the deletion of the cache entry.
   * @param key - The key associated with the cached value to delete.
   * @param callingMethod - The name of the method calling the cache.
   */
  public async delete(key: string, callingMethod: string): Promise<void> {
    this.count(callingMethod, MeasurableCache.methods.DELETE);
    await this.decorated.delete(key, callingMethod);
  }

  /**
   * Clears the entire cache, removing all entries.
   * Use this method with caution, as it wipes all cached data.
   */
  public async clear(): Promise<void> {
    await this.decorated.clear();
  }

  /**
   * Retrieves all keys in the cache that match the given pattern.
   * @param pattern - The pattern to match keys against.
   * @param callingMethod - The name of the method calling the cache.
   * @returns An array of keys that match the pattern (without the cache prefix).
   */
  public async keys(pattern: string, callingMethod: string): Promise<string[]> {
    return await this.decorated.keys(pattern, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.INCR_BY);
    return await this.decorated.incrBy(key, amount, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.LRANGE);
    return await this.decorated.lRange(key, start, end, callingMethod);
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
    this.count(callingMethod, MeasurableCache.methods.RPUSH);
    return await this.decorated.rPush(key, value, callingMethod);
  }

  private count(caller: string, callee: string): void {
    (this.callMap.get(callee) || [callee]).forEach((value: string) =>
      this.cacheMethodsCounter.labels(caller, this.cacheType, value).inc(1),
    );
  }
}
