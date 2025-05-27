// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
import { createClient, RedisClientType } from 'redis';

import { RedisCacheError } from '../../errors/RedisCacheError';
import { IRateLimitStore } from '../../types/IRateLimitStore';

export class RedisRateLimitStore implements IRateLimitStore {
  private redisClient: RedisClientType;
  private logger: Logger;
  private connected: Promise<boolean>;

  // Lua script for atomic INCR and EXPIRE
  // KEYS[1] = key (e.g., ratelimit:ip:method)
  // ARGV[1] = limit (max number of requests)
  // ARGV[2] = duration (in seconds for EXPIRE)
  // Returns: 1 if rate limited, 0 if not rate limited
  private static LUA_SCRIPT = `
    local current = redis.call('INCR', KEYS[1])
    if tonumber(current) == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    if tonumber(current) > tonumber(ARGV[1]) then
      return 1
    end
    return 0
  `;

  constructor(logger: Logger) {
    this.logger = logger.child({ name: 'redisRateLimitStore' });

    const redisUrl = ConfigService.get('REDIS_URL')!;
    const reconnectDelay = ConfigService.get('REDIS_RECONNECT_DELAY_MS') || 500;

    this.redisClient = createClient({
      // @ts-ignore
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          const delay = retries * reconnectDelay;
          this.logger.warn(`Rate limiter Redis reconnection attempt #${retries}. Delay: ${delay}ms`);
          return delay;
        },
      },
    });

    this.connected = this.redisClient
      .connect()
      .then(() => true)
      .catch((error) => {
        this.logger.error(error, 'Rate limiter Redis connection could not be established!');
        return false;
      });

    this.redisClient.on('ready', () => {
      this.connected = Promise.resolve(true);
      this.logger.info(`Rate limiter connected to Redis server (${redisUrl}) successfully!`);
    });

    this.redisClient.on('end', () => {
      this.connected = Promise.resolve(false);
      this.logger.info('Rate limiter disconnected from Redis server!');
    });

    this.redisClient.on('error', (error) => {
      this.connected = Promise.resolve(false);
      const redisError = new RedisCacheError(error);
      if (redisError.isSocketClosed()) {
        this.logger.error(`Rate limiter Redis error when closing socket: ${redisError.message}`);
      } else {
        this.logger.error(`Rate limiter Redis error: ${redisError.fullError}`);
      }
    });
  }

  private async getConnectedClient(): Promise<RedisClientType> {
    const isConnected = await this.connected;
    if (!isConnected) {
      throw new Error('Redis client is not connected');
    }
    return this.redisClient;
  }

  async incrementAndCheck(key: string, limit: number, durationMs: number): Promise<boolean> {
    try {
      const client = await this.getConnectedClient();
      const durationSeconds = Math.ceil(durationMs / 1000);

      // Use eval to execute the Lua script atomically
      const result = await client.eval(RedisRateLimitStore.LUA_SCRIPT, {
        keys: [key],
        arguments: [String(limit), String(durationSeconds)],
      });

      return result === 1;
    } catch (error) {
      this.logger.error(error, 'Redis rate limit operation failed, falling back to allow request');
      return false; // Fallback: don't rate limit on errors to maintain availability
    }
  }

  /**
   * Checks if the Redis client is connected.
   */
  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  /**
   * Disconnects from Redis.
   */
  async disconnect(): Promise<void> {
    try {
      if (await this.isConnected()) {
        await this.redisClient.quit();
      }
    } catch (error) {
      this.logger.error(error, 'Error disconnecting from Redis');
    }
  }
}
