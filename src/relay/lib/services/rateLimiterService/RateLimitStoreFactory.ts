// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';
import { Counter } from 'prom-client';
import { RedisClientType } from 'redis';

import { RateLimitStore } from '../../types';
import { LruRateLimitStore } from './LruRateLimitStore';
import { RedisRateLimitStore } from './RedisRateLimitStore';

/**
 * Factory for creating RateLimitStore instances.
 *
 * Encapsulates the logic for selecting the appropriate storage implementation
 * based on available infrastructure (Redis vs in-memory).
 */
export class RateLimitStoreFactory {
  /**
   * Creates a RateLimitStore instance.
   *
   * @param logger - Logger instance for the store.
   * @param duration - Time window in milliseconds for rate limiting.
   * @param rateLimitStoreFailureCounter - Optional counter for tracking store failures.
   * @param redisClient - Optional Redis client. If provided, creates Redis-backed storage;
   *                      otherwise creates local in-memory storage.
   * @returns A RateLimitStore implementation.
   */
  static create(
    logger: Logger,
    duration: number,
    rateLimitStoreFailureCounter?: Counter,
    redisClient?: RedisClientType,
  ): RateLimitStore {
    return redisClient
      ? new RedisRateLimitStore(redisClient, logger, duration, rateLimitStoreFailureCounter)
      : new LruRateLimitStore(duration);
  }
}
