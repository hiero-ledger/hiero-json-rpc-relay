// SPDX-License-Identifier: Apache-2.0
import { Logger } from 'pino';
import { createClient, RedisClientType } from 'redis';

import { RedisCacheError } from '../errors/RedisCacheError';

export class RedisClientManager {
  private client: RedisClientType;

  private connected: boolean = false;

  constructor(
    private readonly logger: Logger,
    url: string,
    reconnectMs: number,
  ) {
    this.client = createClient({
      url,
      socket: { reconnectStrategy: (retries) => retries * reconnectMs },
    });
    this.client.on('ready', () => {
      this.logger.info(`Redis client connected to ${url}`);
    });
    this.client.on('end', () => {
      this.logger.info('Disconnected from Redis server!');
    });
    this.client.on('error', (error) => {
      const redisError = new RedisCacheError(error);
      if (redisError.isSocketClosed()) {
        this.logger.error(`Error occurred with Redis Connection when closing socket: ${redisError.message}`);
      } else {
        this.logger.error(`Error occurred with Redis Connection: ${redisError.fullError}`);
      }
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getNumberOfConnections(): Promise<number> {
    const list = await this.client.clientList();
    return list.length;
  }

  getClient(): RedisClientType {
    return this.client;
  }
}
