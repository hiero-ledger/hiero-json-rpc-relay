// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
// `import type` keeps the redis package out of the module graph at startup.
// The actual `createClient` value is required lazily inside `getClient()` so
// that the ~10 MB redis + @redis/* bundle is loaded once (on first connection
// attempt) rather than on every process start — saving ~2-3 MB RSS when
// REDIS_ENABLED=false, which is the case for all Solo ≤128Mi profiles.
import type { RedisClientType } from 'redis';

import { RedisCacheError } from '../errors/RedisCacheError';

export class RedisClientManager {
  private static client: RedisClientType;
  private static connected: boolean = false;

  public static isRedisEnabled(): boolean {
    return ConfigService.get('REDIS_ENABLED') && !!ConfigService.get('REDIS_URL');
  }

  public static async connect(): Promise<void> {
    await this.client.connect();
    this.connected = true;
  }

  public static async disconnect(): Promise<void> {
    await this.client.quit();
    this.connected = false;
  }

  public static isConnected(): boolean {
    return this.connected;
  }

  public static async getNumberOfConnections(): Promise<number> {
    const list = await this.client.clientList();

    return list.length;
  }

  public static async getClient(logger: Logger, doConnect: boolean = true): Promise<RedisClientType> {
    if (!this.client) {
      const url = ConfigService.get('REDIS_URL');

      // Load the redis module lazily on first connection so the ~10 MB bundle
      // is never paid when REDIS_ENABLED=false (saves ~2-3 MB RSS at startup).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require('redis') as typeof import('redis');

      this.client = createClient({
        url,
        socket: { reconnectStrategy: (retries) => retries * ConfigService.get('REDIS_RECONNECT_DELAY_MS') },
      });

      this.client.on('ready', () => {
        logger.info(`Redis client connected to ${url}`);
      });

      this.client.on('end', () => {
        logger.info('Disconnected from Redis server!');
      });

      this.client.on('error', (error) => {
        const redisError = new RedisCacheError(error);
        if (redisError.isSocketClosed()) {
          logger.error(`Error occurred with Redis Connection when closing socket: ${redisError.message}`);
        } else {
          logger.error(`Error occurred with Redis Connection: ${redisError.fullError}`);
        }
      });

      if (doConnect) {
        await this.connect();
      }
    }

    return this.client;
  }

  public static async isClientHealthy(logger: Logger): Promise<boolean> {
    try {
      if (RedisClientManager.isRedisEnabled()) {
        const client = await RedisClientManager.getClient(logger);
        await client.ping();
      }
      return true;
    } catch {
      return false;
    }
  }
}
