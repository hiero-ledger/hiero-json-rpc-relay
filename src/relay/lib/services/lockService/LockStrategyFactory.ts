// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';
import { Registry } from 'prom-client';
import { RedisClientType } from 'redis';

import { LockStrategy } from '../../types';
import { LocalLockStrategy } from './LocalLockStrategy';
import { LockMetricsService } from './LockMetricsService';
import { RedisLockStrategy } from './RedisLockStrategy';

/**
 * Factory for creating LockStrategy instances.
 *
 * Encapsulates the logic for selecting the appropriate lock strategy implementation
 * based on available infrastructure (Redis vs in-memory).
 */
export class LockStrategyFactory {
  /**
   * Creates a LockStrategy instance.
   *
   * @param redisClient - Optional Redis client. If provided, creates Redis-backed lock strategy;
   *                      otherwise creates local in-memory lock strategy.
   * @param logger - Logger instance for the lock strategy.
   * @param register - Prometheus registry for metrics.
   * @returns A LockStrategy implementation.
   */
  static create(redisClient: RedisClientType | undefined, logger: Logger, register: Registry): LockStrategy {
    const metricsService = new LockMetricsService(register);

    if (redisClient) {
      return new RedisLockStrategy(redisClient, logger.child({ name: 'redis-lock-strategy' }), metricsService);
    }

    return new LocalLockStrategy(logger.child({ name: 'local-lock-strategy' }), metricsService);
  }
}
