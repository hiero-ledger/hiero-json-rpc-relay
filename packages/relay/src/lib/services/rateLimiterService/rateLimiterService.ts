// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import { formatRequestIdMessage } from '../../../formatters';
import constants from '../../constants';
import { IRateLimitStore } from '../../types/IRateLimitStore';
import { LruRateLimitStore } from './LruRateLimitStore';
import { RedisRateLimitStore } from './RedisRateLimitStore';

/**
 * Service to apply IP and method-based rate limiting using configurable stores.
 */
export class RateLimiterService {
  private store: IRateLimitStore;
  private logger: Logger;
  private ipRateLimitCounter: Counter;
  private duration: number;

  constructor(logger: Logger, register: Registry, duration: number) {
    this.logger = logger;
    this.duration = duration;

    const storeType = this.determineStoreType();
    this.store = this.createStore(storeType, duration);

    const metricCounterName = 'rpc_relay_ip_rate_limit';
    if (register.getSingleMetric(metricCounterName)) {
      register.removeSingleMetric(metricCounterName);
    }
    this.ipRateLimitCounter = new Counter({
      name: metricCounterName,
      help: 'Relay IP rate limit counter',
      labelNames: ['methodName', 'storeType'],
      registers: [register],
    });
  }

  /**
   * Determines which rate limit store type to use based on configuration.
   * @private
   * @returns Store type identifier ('REDIS' or 'LRU').
   */
  private determineStoreType(): string {
    // Check if a specific store type is configured
    const configuredStoreType = ConfigService.get('IP_RATE_LIMIT_STORE');
    if (configuredStoreType) {
      const type = configuredStoreType.trim().toUpperCase();
      if (constants.SUPPORTED_STORE_TYPES.includes(type)) {
        this.logger.info(`Using configured rate limit store type: ${type}`);
        return type;
      }
      this.logger.warn(`Unsupported IP_RATE_LIMIT_STORE value. Using REDIS_ENABLED setting.`);
    }

    return ConfigService.get('REDIS_ENABLED') ? 'REDIS' : 'LRU';
  }

  /**
   * Creates an appropriate rate limit store instance based on the specified type.
   */
  private createStore(storeType: string, duration: number): IRateLimitStore {
    switch (storeType) {
      case 'REDIS':
        return new RedisRateLimitStore(this.logger);
      case 'LRU':
      default:
        return new LruRateLimitStore(duration);
    }
  }

  /**
   * Checks if the Redis store is connected (if applicable).
   */
  async isRedisConnected(): Promise<boolean> {
    if (this.store instanceof RedisRateLimitStore) {
      return this.store.isConnected();
    }
    return false;
  }

  /**
   * Disconnects from Redis (if applicable).
   */
  async disconnect(): Promise<void> {
    if (this.store instanceof RedisRateLimitStore) {
      await this.store.disconnect();
    }
  }

  /**
   * Checks if a request should be rate limited based on IP and method.
   * @param ip - The client's IP address.
   * @param methodName - The method being requested.
   * @param limit - Maximum allowed requests in the current window.
   * @param requestId - Unique identifier for logging.
   * @returns True if rate limit is exceeded, false otherwise.
   */
  async shouldRateLimit(ip: string, methodName: string, limit: number, requestId: string): Promise<boolean> {
    const rateLimitDisabled = ConfigService.get('RATE_LIMIT_DISABLED');
    if (rateLimitDisabled) {
      return false;
    }

    const key = `ratelimit:${ip}:${methodName}`;
    const storeTypeLabel = this.store.constructor.name.replace('Store', '');

    try {
      const isRateLimited = await this.store.incrementAndCheck(key, limit, this.duration);

      if (isRateLimited) {
        this.ipRateLimitCounter.labels(methodName, storeTypeLabel).inc();
        return true;
      }

      return false;
    } catch (error) {
      const requestIdPrefix = formatRequestIdMessage(requestId);
      this.logger.error(
        `${requestIdPrefix}Rate limit store error for IP ${ip} on method ${methodName}. Store: ${storeTypeLabel}. Error: ${error}. Falling back to not rate limiting.`,
      );
      return false;
    }
  }
}
