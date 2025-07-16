// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import { RateLimitKey, RateLimitStore, RateLimitStoreType } from '../../types';
import { RequestDetails } from '../../types/RequestDetails';
import { LruRateLimitStore } from './LruRateLimitStore';
import { RedisRateLimitStore } from './RedisRateLimitStore';

/**
 * Service to apply IP and method-based rate limiting using configurable stores.
 */
export class IPRateLimiterService {
  private store: RateLimitStore;
  private logger: Logger;
  private ipRateLimitCounter: Counter;
  private rateLimitStoreFailureCounter: Counter;

  constructor(logger: Logger, register: Registry, duration: number) {
    this.logger = logger;

    // Initialize IP rate limit counter
    const ipRateLimitMetricName = 'rpc_relay_ip_rate_limit';
    if (register.getSingleMetric(ipRateLimitMetricName)) {
      register.removeSingleMetric(ipRateLimitMetricName);
    }
    this.ipRateLimitCounter = new Counter({
      name: ipRateLimitMetricName,
      help: 'Relay IP rate limit counter',
      labelNames: ['methodName', 'storeType'],
      registers: [register],
    });

    // Initialize store failure counter
    const storeFailureMetricName = 'rpc_relay_rate_limit_store_failures';
    if (register.getSingleMetric(storeFailureMetricName)) {
      register.removeSingleMetric(storeFailureMetricName);
    }
    this.rateLimitStoreFailureCounter = new Counter({
      name: storeFailureMetricName,
      help: 'Rate limit store failure counter',
      labelNames: ['storeType', 'operation'],
      registers: [register],
    });

    const storeType = this.determineStoreType();
    this.store = this.createStore(storeType, duration);
  }

  /**
   * Determines which rate limit store type to use based on configuration.
   * Fails fast if an invalid store type is explicitly configured.
   * @private
   * @returns Store type identifier.
   * @throws Error if an invalid store type is explicitly configured.
   */
  private determineStoreType(): RateLimitStoreType {
    const configuredStoreType = ConfigService.get('IP_RATE_LIMIT_STORE');

    // If explicitly configured, validate it
    if (configuredStoreType !== null) {
      const normalizedType = String(configuredStoreType).trim().toUpperCase() as RateLimitStoreType;

      if (Object.values(RateLimitStoreType).includes(normalizedType)) {
        this.logger.info(`Using configured rate limit store type: ${normalizedType}`);
        return normalizedType;
      }

      // Fail fast for invalid configurations
      throw new Error(
        `Unsupported IP_RATE_LIMIT_STORE value: "${configuredStoreType}". ` +
          `Supported values are: ${Object.values(RateLimitStoreType).join(', ')}`,
      );
    }

    // Only fall back to REDIS_ENABLED if IP_RATE_LIMIT_STORE is not set
    const fallbackType = ConfigService.get('REDIS_ENABLED') ? RateLimitStoreType.REDIS : RateLimitStoreType.LRU;
    this.logger.info(`IP_RATE_LIMIT_STORE not configured, using fallback based on REDIS_ENABLED: ${fallbackType}`);
    return fallbackType;
  }

  /**
   * Creates an appropriate rate limit store instance based on the specified type.
   */
  private createStore(storeType: RateLimitStoreType, duration: number): RateLimitStore {
    switch (storeType) {
      case RateLimitStoreType.REDIS:
        return new RedisRateLimitStore(this.logger, duration, this.rateLimitStoreFailureCounter);
      case RateLimitStoreType.LRU:
        return new LruRateLimitStore(duration);
      default:
        // This should never happen due to enum typing, but including for completeness
        throw new Error(`Unsupported store type: ${storeType}`);
    }
  }

  /**
   * Checks if a request should be rate limited based on IP and method.
   * @param ip - The client's IP address.
   * @param methodName - The method being requested.
   * @param limit - Maximum allowed requests in the current window.
   * @param requestDetails - Request details for logging and tracing.
   * @returns True if rate limit is exceeded, false otherwise.
   */
  async shouldRateLimit(
    ip: string,
    methodName: string,
    limit: number,
    requestDetails: RequestDetails,
  ): Promise<boolean> {
    const rateLimitDisabled = ConfigService.get('RATE_LIMIT_DISABLED');
    if (rateLimitDisabled) {
      return false;
    }

    const key = new RateLimitKey(ip, methodName);
    const storeTypeLabel = this.store.constructor.name.replace('Store', '');

    const isRateLimited = await this.store.incrementAndCheck(key, limit, requestDetails);

    if (isRateLimited) {
      this.ipRateLimitCounter.labels(methodName, storeTypeLabel).inc();
      return true;
    }

    return false;
  }

  /**
   * Gets the underlying rate limit store for testing purposes.
   * @returns The rate limit store instance.
   */
  get rateLimitStore(): RateLimitStore {
    return this.store;
  }
}
