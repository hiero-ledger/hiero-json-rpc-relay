// SPDX-License-Identifier: Apache-2.0

import { type RedisClientType } from 'redis';

import { type ITransactionTracingStorage, type TransactionTraceRecord } from '../../types/transactionTracing';
import { TRACE_HASH_KEY_PREFIX } from './constants';

/**
 * Redis-backed implementation of {@link ITransactionTracingStorage}.
 *
 * Records are stored as JSON under the shared {@link TRACE_HASH_KEY_PREFIX} key namespace. TTL is applied via the
 * `SET ... EX` option (ms converted to seconds); a non-positive TTL persists the record indefinitely.
 */
export class RedisTransactionTracingStorage implements ITransactionTracingStorage {
  /** TTL applied to keys, in seconds. `0` (or below) means no expiration. */
  private readonly ttlSeconds: number;

  /**
   * @param redisClient - A connected Redis client.
   * @param ttlMs - Per-entry TTL in milliseconds (`0`/`-1` = eternal).
   */
  constructor(
    private readonly redisClient: RedisClientType,
    ttlMs: number,
  ) {
    this.ttlSeconds = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : 0;
  }

  private hashKey(hash: string): string {
    return `${TRACE_HASH_KEY_PREFIX}${hash}`;
  }

  async set(hash: string, record: TransactionTraceRecord): Promise<void> {
    const hashKey = this.hashKey(hash);
    if (this.ttlSeconds > 0) {
      await this.redisClient.set(hashKey, JSON.stringify(record), { EX: this.ttlSeconds });
    } else {
      await this.redisClient.set(hashKey, JSON.stringify(record));
    }
  }

  async get(hash: string): Promise<TransactionTraceRecord | null> {
    const value = await this.redisClient.get(this.hashKey(hash));
    return value != null ? (JSON.parse(value) as TransactionTraceRecord) : null;
  }
}
