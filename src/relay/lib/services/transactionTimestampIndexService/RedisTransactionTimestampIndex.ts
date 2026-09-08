// SPDX-License-Identifier: Apache-2.0

import { type RedisClientType } from 'redis';

import constants from '../../constants';
import { type ITransactionTimestampIndex } from '../../types/ITransactionTimestampIndex';

/**
 * Redis-backed implementation of {@link ITransactionTimestampIndex}.
 *
 * A batch is written in a single `MULTI`, so serving one block costs one round trip rather than one per
 * transaction. A non-positive TTL keeps entries indefinitely.
 */
export class RedisTransactionTimestampIndex implements ITransactionTimestampIndex {
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
    return `${constants.TX_TIMESTAMP_INDEX_KEY_PREFIX}${hash}`;
  }

  async setMany(entries: ReadonlyArray<readonly [string, string]>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const multi = this.redisClient.multi();
    for (const [hash, consensusTimestamp] of entries) {
      const hashKey = this.hashKey(hash);
      if (this.ttlSeconds > 0) {
        multi.set(hashKey, consensusTimestamp, { EX: this.ttlSeconds });
      } else {
        multi.set(hashKey, consensusTimestamp);
      }
    }
    await multi.exec();
  }

  async get(hash: string): Promise<string | null> {
    return await this.redisClient.get(this.hashKey(hash));
  }
}
