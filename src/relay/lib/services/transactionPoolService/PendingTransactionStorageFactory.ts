// SPDX-License-Identifier: Apache-2.0

import { RedisClientType } from 'redis';

import { PendingTransactionStorage } from '../../types/transactionPool';
import { LocalPendingTransactionStorage } from './LocalPendingTransactionStorage';
import { RedisPendingTransactionStorage } from './RedisPendingTransactionStorage';

/**
 * Factory for creating PendingTransactionStorage instances.
 *
 * Encapsulates the logic for selecting the appropriate storage implementation
 * based on available infrastructure (Redis vs in-memory).
 */
export class PendingTransactionStorageFactory {
  /**
   * Creates a PendingTransactionStorage instance.
   *
   * @param redisClient - Optional Redis client. If provided, creates Redis-backed storage;
   *                      otherwise creates local in-memory storage.
   * @returns A PendingTransactionStorage implementation.
   */
  static create(redisClient?: RedisClientType): PendingTransactionStorage {
    return redisClient ? new RedisPendingTransactionStorage(redisClient) : new LocalPendingTransactionStorage();
  }
}
