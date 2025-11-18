// SPDX-License-Identifier: Apache-2.0

import { ICacheClient } from './ICacheClient';

/**
 * Represents a LocalLRUCache instance that uses an LRU (Least Recently Used) caching strategy
 * for caching items internally from requests.
 * @implements {ICacheClient}
 */
export class FallbackCache implements ICacheClient {
  private decorated: ICacheClient;
  private fallback: ICacheClient;
  private readonly handleError: (message: string, previous: Error | unknown) => void;

  public constructor(
    decorated: ICacheClient,
    fallback: ICacheClient,
    handleError: (message: string, previous: Error | unknown) => void,
  ) {
    this.decorated = decorated;
    this.fallback = fallback;
    this.handleError = handleError;
  }

  /**
   * Retrieves a cached value associated with the given key.
   * If the value exists in the cache, updates metrics and logs the retrieval.
   * @param key - The key associated with the cached value.
   * @param callingMethod - The name of the method calling the cache.
   * @returns The cached value if found, otherwise null.
   */
  public async getAsync(key: string, callingMethod: string): Promise<any> {
    try {
      return await this.decorated.getAsync(key, callingMethod);
    } catch (error) {
      this.handleError(
        'Error occurred while getting the cache from {{DECORATED}}. Fallback to {{FALLBACK}} cache.',
        error,
      );
      return await this.fallback.getAsync(key, callingMethod);
    }
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
    try {
      await this.decorated.set(key, value, callingMethod, ttl);
    } catch (error) {
      this.handleError(
        'Error occurred while setting the cache to {{DECORATED}}. Fallback to {{FALLBACK}} cache.',
        error,
      );
      await this.fallback.set(key, value, callingMethod, ttl);
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
    try {
      await this.decorated.multiSet(keyValuePairs, callingMethod);
    } catch (error) {
      this.handleError(
        'Error occurred while setting the cache to {{DECORATED}}. Fallback to {{FALLBACK}} cache.',
        error,
      );
      await this.fallback.multiSet(keyValuePairs, callingMethod);
    }
  }

  /**
   * Deletes a cached value associated with the given key.
   * Logs the deletion of the cache entry.
   * @param key - The key associated with the cached value to delete.
   * @param callingMethod - The name of the method calling the cache.
   */
  public async delete(key: string, callingMethod: string): Promise<void> {
    try {
      await this.decorated.delete(key, callingMethod);
    } catch (error) {
      this.handleError('Error occurred while deleting cache from {{DECORATED}}.', error);
      await this.fallback.delete(key, callingMethod);
    }
  }

  /**
   * Clears the entire cache, removing all entries.
   * Use this method with caution, as it wipes all cached data.
   */
  public async clear(): Promise<void> {
    try {
      await this.decorated.clear();
    } catch (error) {
      this.handleError('Error occurred while clearing {{DECORATED}} cache.', error);
      await this.fallback.clear();
    }
  }

  /**
   * Retrieves all keys in the cache that match the given pattern.
   * @param pattern - The pattern to match keys against.
   * @param callingMethod - The name of the method calling the cache.
   * @returns An array of keys that match the pattern (without the cache prefix).
   */
  public async keys(pattern: string, callingMethod: string): Promise<string[]> {
    try {
      return await this.decorated.keys(pattern, callingMethod);
    } catch (error) {
      this.handleError(`Error occurred while clearing {{DECORATED}} cache.`, error);
      return await this.fallback.keys(pattern, callingMethod);
    }
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
    try {
      return await this.decorated.incrBy(key, amount, callingMethod);
    } catch (error) {
      this.handleError(`Error occurred while incrementing cache in {{DECORATED}}.`, error);
      return await this.fallback.incrBy(key, amount, callingMethod);
    }
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
    try {
      return await this.decorated.lRange(key, start, end, callingMethod);
    } catch (error) {
      this.handleError(`Error occurred while pushing cache in {{DECORATED}}.`, error);
      return await this.fallback.lRange(key, start, end, callingMethod);
    }
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
    try {
      return await this.decorated.rPush(key, value, callingMethod);
    } catch (error) {
      this.handleError(`Error occurred while pushing cache in {{DECORATED}}.`, error);
      return await this.fallback.rPush(key, value, callingMethod);
    }
  }
}
