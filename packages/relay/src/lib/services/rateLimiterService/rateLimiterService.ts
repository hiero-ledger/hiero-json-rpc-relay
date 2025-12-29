// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Counter, Registry } from 'prom-client';

import { RateLimitKey, RateLimitStore } from '../../types';
import { RequestDetails } from '../../types/RequestDetails';

/**
 * Service to apply IP and method-based rate limiting using configurable stores.
 */
export class IPRateLimiterService {
  private store: RateLimitStore;
  private ipRateLimitCounter: Counter;

  /**
   * Creates an IPRateLimiterService instance.
   *
   * @param store - The rate limit storage backend (LRU or Redis-backed).
   * @param logger - Logger instance for logging.
   * @param register - Prometheus registry for metrics.
   */
  constructor(store: RateLimitStore, register: Registry) {
    this.store = store;

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
