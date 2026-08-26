// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { type RedisClientType } from 'redis';

import { type ITransactionTracingStorage } from '../../types/transactionTracing';
import { LocalTransactionTracingStorage } from './LocalTransactionTracingStorage';
import { RedisTransactionTracingStorage } from './RedisTransactionTracingStorage';

/**
 * Creates {@link ITransactionTracingStorage} instances: Redis-backed when a connected client is provided,
 * otherwise local in-memory.
 */
export class TransactionTracingStorageFactory {
  /**
   * @param logger - Logger passed to the local storage's internal cache.
   * @param ttlMs - Per-entry TTL in milliseconds (`0`/`-1` = eternal).
   * @param redisClient - Optional connected Redis client; when present, Redis-backed storage is created.
   * @returns A Redis-backed storage when a client is provided, otherwise a local in-memory one.
   */
  static create(logger: Logger, ttlMs: number, redisClient?: RedisClientType): ITransactionTracingStorage {
    return redisClient
      ? new RedisTransactionTracingStorage(redisClient, ttlMs)
      : new LocalTransactionTracingStorage(logger, ttlMs);
  }
}
