// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { type RedisClientType } from 'redis';

import { ConfigService } from '../../../../config-service/services';
import { type ITransactionTimestampIndex } from '../../types/ITransactionTimestampIndex';
import { LocalTransactionTimestampIndex } from './LocalTransactionTimestampIndex';
import { RedisTransactionTimestampIndex } from './RedisTransactionTimestampIndex';

/**
 * Disabled implementation of {@link ITransactionTimestampIndex}: writes are dropped and every lookup misses.
 *
 * Returned when `TX_TIMESTAMP_INDEX_ENABLED` is off, so holders need no enablement check of their own. A miss
 * is the answer the relay gave before this index existed.
 */
export class DisabledTransactionTimestampIndex implements ITransactionTimestampIndex {
  async setMany(): Promise<void> {
    // intentionally empty: the index is disabled
  }

  async get(): Promise<string | null> {
    return null;
  }
}

/**
 * Creates {@link ITransactionTimestampIndex} instances: Redis-backed when a connected client is provided,
 * otherwise local in-memory, and disabled when `TX_TIMESTAMP_INDEX_ENABLED` is off.
 */
export class TransactionTimestampIndexFactory {
  /**
   * @param logger - Logger passed to the local implementation's internal cache.
   * @param redisClient - Optional connected Redis client; when present, Redis-backed storage is created.
   * @returns A disabled index when switched off, a Redis-backed one when a client is supplied, otherwise a
   *   local one.
   */
  static create(logger: Logger, redisClient?: RedisClientType): ITransactionTimestampIndex {
    if (!ConfigService.get('TX_TIMESTAMP_INDEX_ENABLED')) {
      return new DisabledTransactionTimestampIndex();
    }

    const ttlMs = ConfigService.get('TX_TIMESTAMP_INDEX_TTL_MS');

    return redisClient
      ? new RedisTransactionTimestampIndex(redisClient, ttlMs)
      : new LocalTransactionTimestampIndex(logger, ttlMs, ConfigService.get('TX_TIMESTAMP_INDEX_MAX_ENTRIES'));
  }
}
