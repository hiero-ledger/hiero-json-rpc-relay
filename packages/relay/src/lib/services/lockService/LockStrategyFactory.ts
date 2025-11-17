// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';
import { RedisClientType } from 'redis';

import { LockStrategy } from '../../types';
import { LocalLockStrategy } from './LocalLockStrategy';
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
   * @returns A LockStrategy implementation.
   */

  static create(redisClient: RedisClientType | undefined, logger: Logger): LockStrategy {
    if (redisClient) {
      return new RedisLockStrategy(redisClient, logger.child({ name: 'redis-lock-strategy' }));
    }

    return new LocalLockStrategy(logger);
  }
}
