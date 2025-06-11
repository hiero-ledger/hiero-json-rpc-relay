// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import pino, { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import { LocalLRUCache, RedisCache } from '../../clients';
import { ICacheClient } from '../../clients/cache/ICacheClient';
import { RedisCacheError } from '../../errors/RedisCacheError';
import { RequestDetails } from '../../types';

export enum CACHE_LEVEL {
  L1 = 'L1_CACHE',
  L2 = 'L2_CACHE',
}

/**
 * A service that manages caching using different cache implementations based on configuration.
 */
export class CacheService {
  /**
   * The LRU cache used for caching items from requests.
   *
   * @private
   */
  private readonly internalCache: ICacheClient;

  /**
   * The Redis cache used for caching items from requests.
   *
   * @private
   */
  private readonly sharedCache: ICacheClient;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * The metrics register used for metrics tracking.
   * @private
   */
  private readonly register: Registry;

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

  public constructor(logger: Logger, register: Registry, reservedKeys: Set<string> = new Set()) {
    this.logger = logger;
    this.register = register;

    this.internalCache = new LocalLRUCache(logger.child({ name: 'localLRUCache' }), register, reservedKeys);
    this.sharedCache = this.internalCache;
    this.isSharedCacheEnabled = !ConfigService.get('TEST') && this.isRedisEnabled();
    this.shouldMultiSet = ConfigService.get('MULTI_SET');

    if (this.isSharedCacheEnabled) {
      this.sharedCache = new RedisCache(logger.child({ name: 'redisCache' }), register);
    }

    /**
     * Labels:
     *  callingMethod - The method initiating the cache operation
     *  cacheType - redis/lru
     *  method - The CacheService method being called
     */
    const metricName = 'rpc_cache_service_methods_counter';
    this.register.removeSingleMetric(metricName);
    this.cacheMethodsCounter = new Counter({
      name: metricName,
      help: 'Counter for calls to methods of CacheService separated by CallingMethod and CacheType',
      registers: [register],
      labelNames: ['callingMethod', 'cacheType', 'method'],
    });
  }

  /**
   * Array of singletons for L1 and L2 layers
   *
   * @private
   */
  private static instances: CacheService[] = [];

  /**
   * Get a cache service instance
   *
   * @param type
   * @param registry
   * @param reservedKeys
   */
  public static getInstance(
    type: CACHE_LEVEL,
    registry: Registry = new Registry(),
    reservedKeys: Set<string> = new Set(),
  ): CacheService {
    if (!this.instances[type]) {
      const logger = pino({ level: ConfigService.get('LOG_LEVEL') });
      this.instances[type] = new CacheService(logger.child({ name: type }), registry, reservedKeys);
    }

    return this.instances[type];
  }

  /**
   * Checks if the shared cache instance is connected to a Redis server.
   *
   * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether the Redis client is connected.
   */
  async isRedisClientConnected(): Promise<boolean> {
    if (this.sharedCache instanceof RedisCache) {
      return this.sharedCache.isConnected();
    }
    return false;
  }

  /**
   * Connects the Redis client if it is not already connected.
   *
   * @returns {Promise<void>} A Promise that resolves when the client is connected.
   */
  async connectRedisClient(): Promise<void> {
    if (this.sharedCache instanceof RedisCache) {
      try {
        if (await this.sharedCache.isConnected()) {
          return;
        }
        await this.sharedCache.connect();
      } catch (e) {
        const redisError = new RedisCacheError(e);
        this.logger.error(`Error occurred when connecting to Redis. ${redisError}`);
      }
    }
  }

  /**
   * Disconnects the Redis client if it is connected.
   *
   * @returns {Promise<void>} A Promise that resolves when the client is disconnected.
   */
  async disconnectRedisClient(): Promise<void> {
    if (this.sharedCache instanceof RedisCache) {
      try {
        if (!(await this.sharedCache.isConnected())) {
          return;
        }
        await this.sharedCache.disconnect();
      } catch (e) {
        const redisError = new RedisCacheError(e);
        this.logger.error(`Error occurred when disconnecting from Redis. ${redisError}`);
      }
    }
  }

  /**
   * Retrieves the number of active connections to the Redis server.
   *
   * @returns {Promise<number>} A Promise that resolves with the number of active connections.
   */
  async getNumberOfRedisConnections(): Promise<number> {
    if (this.sharedCache instanceof RedisCache) {
      try {
        return await this.sharedCache.getNumberOfConnections();
      } catch (e) {
        const redisError = new RedisCacheError(e);
        this.logger.error(`Error occurred when getting the number of Redis connections. ${redisError}`);
      }
    }
    return 0;
  }

  /**
   * Checks whether Redis caching is enabled based on environment variables.
   * @private
   * @returns {boolean} Returns true if Redis caching is enabled, otherwise false.
   */
  public isRedisEnabled(): boolean {
    return ConfigService.get('REDIS_ENABLED') && !!ConfigService.get('REDIS_URL');
  }

  /**
   * Retrieves a value from the cache asynchronously.
   *
   * @param {string} key - The cache key.
   * @param {string} callingMethod - The name of the calling method.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<any>} A Promise that resolves with the cached value or null if not found.
   */
  private async getFromSharedCache(key: string, callingMethod: string, requestDetails: RequestDetails): Promise<any> {
    try {
      this.cacheMethodsCounter
        .labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.GET_ASYNC)
        .inc(1);

      return await this.sharedCache.get(key, callingMethod, requestDetails);
    } catch (error) {
      const redisError = new RedisCacheError(error);
      this.logger.error(
        redisError,
        `${requestDetails.formattedRequestId} Error occurred while getting the cache from Redis. Fallback to internal cache.`,
      );

      // fallback to internal cache in case of Redis error
      return await this.getFromInternalCache(key, callingMethod, requestDetails);
    }
  }

  /**
   * If SharedCacheEnabled will use shared, otherwise will fallback to internal cache.
   * @param {string} key - The cache key.
   * @param {string} callingMethod - The name of the calling method.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<T | null>} A Promise that resolves with the cached value or null if not found.
   * @template T - The type of the cached value.
   */
  public async getAsync<T = any>(key: string, callingMethod: string, requestDetails: RequestDetails): Promise<T> {
    if (this.isSharedCacheEnabled) {
      return await this.getFromSharedCache(key, callingMethod, requestDetails);
    } else {
      return await this.getFromInternalCache(key, callingMethod, requestDetails);
    }
  }

  /**
   * Retrieves a value from the internal cache.
   *
   * @param {string} key - The cache key.
   * @param {string} callingMethod - The name of the calling method.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<any>} A Promise that resolves with the cached value or null if not found.
   */
  private async getFromInternalCache(key: string, callingMethod: string, requestDetails: RequestDetails): Promise<any> {
    this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.GET).inc(1);

    return await this.internalCache.get(key, callingMethod, requestDetails);
  }

  /**
   * Sets a value in the cache associated with the given key.
   * If the shared cache is enabled and an error occurs while setting in it,
   * the internal cache is used as a fallback.
   * @param {string} key - The key to associate with the value.
   * @param {*} value - The value to cache.
   * @param {string} callingMethod - The name of the method calling the cache.
   * @param {number} ttl - Time to live for the cached value in milliseconds (optional).
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  public async set(
    key: string,
    value: any,
    callingMethod: string,
    requestDetails: RequestDetails,
    ttl?: number,
  ): Promise<void> {
    if (this.isSharedCacheEnabled) {
      try {
        this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.SET).inc(1);

        await this.sharedCache.set(key, value, callingMethod, requestDetails, ttl);
        return;
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while setting the cache to Redis. Fallback to internal cache.`,
        );
      }
    }

    // fallback to internal cache in case of Redis error
    this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
    await this.internalCache.set(key, value, callingMethod, requestDetails, ttl);
  }

  /**
   * Sets multiple values in the cache, each associated with its respective key.
   * Depends on env. variable, whether we will be using pipelining method or multiSet
   * If the shared cache is enabled and an error occurs while setting in it,
   * the internal cache is used as a fallback.
   * @param {Record<string, any>} entries - An object containing key-value pairs to cache.
   * @param {string} callingMethod - The name of the method calling the cache.
   * @param {number} [ttl] - Time to live for the cached value in milliseconds (optional).
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  public async multiSet(
    entries: Record<string, any>,
    callingMethod: string,
    requestDetails: RequestDetails,
    ttl?: number,
  ): Promise<void> {
    if (this.isSharedCacheEnabled) {
      const metricsMethod = this.shouldMultiSet ? CacheService.methods.MSET : CacheService.methods.PIPELINE;
      try {
        if (this.shouldMultiSet) {
          await this.sharedCache.multiSet(entries, callingMethod, requestDetails);
        } else {
          await this.sharedCache.pipelineSet(entries, callingMethod, requestDetails, ttl);
        }

        this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.REDIS, metricsMethod).inc(1);
        return;
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while setting the cache to Redis. Fallback to internal cache.`,
        );
      }
    }

    // fallback to internal cache, but use pipeline, because of it's TTL support
    await this.internalCache.pipelineSet(entries, callingMethod, requestDetails, ttl);
    this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
  }

  /**
   * Deletes a cached value associated with the given key.
   * If the shared cache is enabled and an error occurs while deleting from it, just logs the error.
   * Else the internal cache deletion is attempted.
   * @param {string} key - The key associated with the cached value to delete.
   * @param {string} callingMethod - The name of the method calling the cache.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  public async delete(key: string, callingMethod: string, requestDetails: RequestDetails): Promise<void> {
    if (this.isSharedCacheEnabled) {
      try {
        this.cacheMethodsCounter
          .labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.DELETE)
          .inc(1);

        await this.sharedCache.delete(key, callingMethod, requestDetails);
        return;
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while deleting cache from Redis.`,
        );
      }
    }

    // fallback to internal cache in case of Redis error
    this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.DELETE).inc(1);
    await this.internalCache.delete(key, callingMethod, requestDetails);
  }

  /**
   * Clears the cache.
   * If the shared cache is enabled and an error occurs while clearing it, just logs the error.
   * Else the internal cache clearing is attempted.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   */
  public async clear(requestDetails: RequestDetails): Promise<void> {
    if (this.isSharedCacheEnabled) {
      try {
        await this.sharedCache.clear();
        return;
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while clearing Redis cache.`,
        );
      }
    }

    // fallback to internal cache in case of Redis error
    await this.internalCache.clear();
  }

  /**
   * Increments the value of a key in the cache by the specified amount.
   * @param {string} key - The key to increment.
   * @param {number} amount - The amount to increment by.
   * @param {string} callingMethod - The name of the calling method.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<number>} A Promise that resolves with the new value of the key after incrementing.
   */
  public async incrBy(
    key: string,
    amount: number,
    callingMethod: string,
    requestDetails: RequestDetails,
  ): Promise<number> {
    if (this.isSharedCacheEnabled && this.sharedCache instanceof RedisCache) {
      try {
        this.cacheMethodsCounter
          .labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.INCR_BY)
          .inc(1);

        return await this.sharedCache.incrBy(key, amount, callingMethod, requestDetails);
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while incrementing cache in Redis.`,
        );
      }
    }

    // Fallback to internal cache
    const value = await this.getFromInternalCache(key, callingMethod, requestDetails);
    const newValue = value + amount;
    const remainingTtl =
      this.internalCache instanceof LocalLRUCache
        ? await this.internalCache.getRemainingTtl(key, callingMethod, requestDetails)
        : undefined;

    this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
    await this.internalCache.set(key, newValue, callingMethod, requestDetails, remainingTtl);

    return newValue;
  }

  /**
   * Pushes a value to the end of a list in the cache.
   * @param {string} key - The key of the list.
   * @param {*} value - The value to push.
   * @param {string} callingMethod - The name of the calling method.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<number>} A Promise that resolves with the new length of the list after pushing.
   */
  public async rPush(key: string, value: any, callingMethod: string, requestDetails: RequestDetails): Promise<number> {
    if (this.isSharedCacheEnabled && this.sharedCache instanceof RedisCache) {
      try {
        this.cacheMethodsCounter
          .labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.RPUSH)
          .inc(1);

        return await this.sharedCache.rPush(key, value, callingMethod, requestDetails);
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while pushing cache in Redis.`,
        );
      }
    }

    // Fallback to internal cache
    const values = (await this.getFromInternalCache(key, callingMethod, requestDetails)) ?? [];
    if (!Array.isArray(values)) {
      throw new Error(`Value at key ${key} is not an array`);
    }
    values.push(value);
    const remainingTtl =
      this.internalCache instanceof LocalLRUCache
        ? await this.internalCache.getRemainingTtl(key, callingMethod, requestDetails)
        : undefined;

    this.cacheMethodsCounter.labels(callingMethod, CacheService.cacheTypes.LRU, CacheService.methods.SET).inc(1);
    await this.internalCache.set(key, values, callingMethod, requestDetails, remainingTtl);

    return values.length;
  }

  /**
   * Retrieves a range of values from a list in the cache.
   * @param {string} key - The key of the list.
   * @param {number} start - The start index of the range.
   * @param {number} end - The end index of the range.
   * @param {string} callingMethod - The name of the calling method.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<T[]>} A Promise that resolves with the values in the range.
   * @template T - The type of the values in the list.
   */
  public async lRange<T = any>(
    key: string,
    start: number,
    end: number,
    callingMethod: string,
    requestDetails: RequestDetails,
  ): Promise<T[]> {
    if (this.isSharedCacheEnabled && this.sharedCache instanceof RedisCache) {
      try {
        this.cacheMethodsCounter
          .labels(callingMethod, CacheService.cacheTypes.REDIS, CacheService.methods.LRANGE)
          .inc(1);

        return await this.sharedCache.lRange(key, start, end, callingMethod, requestDetails);
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while getting cache in Redis.`,
        );
      }
    }

    // Fallback to internal cache
    const values = (await this.getFromInternalCache(key, callingMethod, requestDetails)) ?? [];
    if (!Array.isArray(values)) {
      throw new Error(`Value at key ${key} is not an array`);
    }
    if (end < 0) {
      end = values.length + end;
    }
    return values.slice(start, end + 1);
  }

  /**
   * Retrieves all keys matching the given pattern.
   * @param {string} pattern - The pattern to match keys against.
   * @param {string} callingMethod - The name of the calling method.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<string[]>} A Promise that resolves with an array of keys that match the pattern.
   */
  async keys(pattern: string, callingMethod: string, requestDetails: RequestDetails): Promise<string[]> {
    if (this.isSharedCacheEnabled && this.sharedCache instanceof RedisCache) {
      try {
        return await this.sharedCache.keys(pattern, callingMethod, requestDetails);
      } catch (error) {
        const redisError = new RedisCacheError(error);
        this.logger.error(
          redisError,
          `${requestDetails.formattedRequestId} Error occurred while getting keys from Redis.`,
        );
      }
    }

    // Fallback to internal cache
    return this.internalCache.keys(pattern, callingMethod, requestDetails);
  }
}
