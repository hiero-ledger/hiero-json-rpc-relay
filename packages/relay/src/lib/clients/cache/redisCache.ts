// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
import { Registry } from 'prom-client';
import { createClient } from 'redis';

import { Utils } from '../../../utils';
import { IRedisCacheClient } from './IRedisCacheClient';

/**
 * A class that provides caching functionality using Redis.
 */
export class RedisCache implements IRedisCacheClient {
  /**
   * Configurable options used when initializing the cache.
   *
   * @private
   */
  private readonly options = {
    // Max time to live in ms, for items before they are considered stale.
    ttl: ConfigService.get('CACHE_TTL'),
  };

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
   * The Redis client.
   * @private
   */
  private readonly client: ReturnType<typeof createClient>;

  /**
   * Creates an instance of `RedisCache`.
   *
   * @param {Logger} logger - The logger instance.
   * @param {Registry} register - The metrics registry.
   */
  public constructor(logger: Logger, register: Registry, client: ReturnType<typeof createClient>) {
    this.logger = logger;
    this.register = register;
    this.client = client;
  }

  async getConnectedClient(): Promise<ReturnType<typeof createClient>> {
    return this.client.isConnected().then(() => this.client);
  }

  /**
   * Retrieves a value from the cache.
   *
   * @param key - The cache key.
   * @param callingMethod - The name of the calling method.
   * @returns The cached value or null if not found.
   */
  async get(key: string, callingMethod: string): Promise<any> {
    const client = await this.getConnectedClient();
    const result = await client.get(key);
    if (result) {
      if (this.logger.isLevelEnabled('trace')) {
        const censoredKey = key.replace(Utils.IP_ADDRESS_REGEX, '<REDACTED>');
        const censoredValue = result.replace(/"ipAddress":"[^"]+"/, '"ipAddress":"<REDACTED>"');
        this.logger.trace(`Returning cached value ${censoredKey}:${censoredValue} on ${callingMethod} call`);
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
    const client = await this.getConnectedClient();
    const serializedValue = JSON.stringify(value);
    const resolvedTtl = ttl ?? this.options.ttl; // in milliseconds
    if (resolvedTtl > 0) {
      await client.set(key, serializedValue, { PX: resolvedTtl });
    } else {
      await client.set(key, serializedValue);
    }

    const censoredKey = key.replace(Utils.IP_ADDRESS_REGEX, '<REDACTED>');
    const censoredValue = serializedValue.replace(/"ipAddress":"[^"]+"/, '"ipAddress":"<REDACTED>"');
    const message = `Caching ${censoredKey}:${censoredValue} on ${callingMethod} for ${
      resolvedTtl > 0 ? `${resolvedTtl} ms` : 'indefinite time'
    }`;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${message}`);
    }
    // TODO: add metrics
  }

  /**
   * Stores multiple key-value pairs in the cache.
   *
   * @param keyValuePairs - An object where each property is a key and its value is the value to be cached.
   * @param callingMethod - The name of the calling method.
   * @returns A Promise that resolves when the values are cached.
   */
  async multiSet(keyValuePairs: Record<string, any>, callingMethod: string): Promise<void> {
    const client = await this.getConnectedClient();
    // Serialize values
    const serializedKeyValuePairs: Record<string, string> = {};
    for (const [key, value] of Object.entries(keyValuePairs)) {
      serializedKeyValuePairs[key] = JSON.stringify(value);
    }

    // Perform mSet operation
    await client.mSet(serializedKeyValuePairs);

    // Log the operation
    const entriesLength = Object.keys(keyValuePairs).length;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`caching multiple keys via ${callingMethod}, total keys: ${entriesLength}`);
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
    const client = await this.getConnectedClient();
    const resolvedTtl = ttl ?? this.options.ttl; // in milliseconds

    const pipeline = client.multi();

    for (const [key, value] of Object.entries(keyValuePairs)) {
      const serializedValue = JSON.stringify(value);
      pipeline.set(key, serializedValue, { PX: resolvedTtl });
    }

    // Execute pipeline operation
    await pipeline.execAsPipeline();

    if (this.logger.isLevelEnabled('trace')) {
      // Log the operation
      const entriesLength = Object.keys(keyValuePairs).length;
      this.logger.trace(`caching multiple keys via ${callingMethod}, total keys: ${entriesLength}`);
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
    const client = await this.getConnectedClient();
    await client.del(key);
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`delete cache for ${key} on ${callingMethod} call`);
    }
    // TODO: add metrics
  }

  /**
   * Clears the entire cache.
   *
   * @returns {Promise<void>} A Promise that resolves when the cache is cleared.
   */
  async clear(): Promise<void> {
    const client = await this.getConnectedClient();
    await client.flushAll();
  }

  /**
   * Checks if the client is connected to the Redis server.
   *
   * @returns {Promise<boolean>} A Promise that resolves to true if the client is connected, false otherwise.
   */
  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  /**
   * Retrieves the number of connections to the Redis server.
   *
   * @returns {Promise<number>} A Promise that resolves to the number of connections.
   * @throws {Error} If an error occurs while retrieving the number of connections.
   */
  async getNumberOfConnections(): Promise<number> {
    const client = await this.getConnectedClient();
    const clientList = await client.clientList();
    return clientList.length;
  }

  /**
   * Connects the client to the Redis server.
   *
   * @returns {Promise<void>} A Promise that resolves when the client is connected.
   * @throws {Error} If an error occurs while connecting to Redis.
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnects the client from the Redis server.
   *
   * @returns {Promise<void>} A Promise that resolves when the client is disconnected.
   * @throws {Error} If an error occurs while disconnecting from Redis.
   */
  async disconnect(): Promise<void> {
    const client = await this.getConnectedClient();
    await client.quit();
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
    const client = await this.getConnectedClient();
    const result = await client.incrBy(key, amount);
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`incrementing ${key} by ${amount} on ${callingMethod} call`);
    }
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
    const client = await this.getConnectedClient();
    const result = await client.lRange(key, start, end);
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`retrieving range [${start}:${end}] from ${key} on ${callingMethod} call`);
    }
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
    const client = await this.getConnectedClient();
    const serializedValue = JSON.stringify(value);
    const result = await client.rPush(key, serializedValue);
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`pushing ${serializedValue} to ${key} on ${callingMethod} call`);
    }
    return result;
  }

  /**
   * Retrieves all keys matching a pattern.
   * @param pattern The pattern to match
   * @param callingMethod The name of the calling method
   * @returns The list of keys matching the pattern
   */
  async keys(pattern: string, callingMethod: string): Promise<string[]> {
    const client = await this.getConnectedClient();
    const result = await client.keys(pattern);
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`retrieving keys matching ${pattern} on ${callingMethod} call`);
    }
    return result;
  }
}
