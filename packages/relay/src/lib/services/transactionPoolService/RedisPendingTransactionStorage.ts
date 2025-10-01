// SPDX-License-Identifier: Apache-2.0
import { RedisClientType } from 'redis';

import { AddToListResult, PendingTransactionStorage } from '../../types/transactionPool';

export class RedisPendingTransactionStorage implements PendingTransactionStorage {
  /**
   * Prefix used to namespace all keys managed by this storage.
   *
   * @remarks
   * Using a prefix allows efficient scanning and cleanup of related keys
   */
  private readonly keyPrefix = 'pending:';

  /**
   * Creates a new Redis-backed pending transaction storage.
   *
   * @param redisClient - A connected {@link RedisClientType} instance.
   */
  constructor(private readonly redisClient: RedisClientType) {}

  /**
   * Resolves the Redis key for a given address.
   *
   * @param addr - Account address whose pending list key should be derived.
   * @returns The Redis key (e.g., `pending:<address>`).
   */
  private keyFor(addr: string): string {
    return `${this.keyPrefix}${addr}`;
  }

  /**
   * Appends a transaction hash to the pending list for the provided address.
   *
   * @remarks
   * This uses Redis `RPUSH`, which is atomic. The integer result from Redis is
   * the new length of the list after the append.
   *
   * Duplicate values are not prevented by this method.
   *
   * @param addr - Account address whose pending list will be appended to.
   * @param txHash - Transaction hash to append.
   * @returns Result indicating success and the new list length.
   */
  async addToList(addr: string, txHash: string): Promise<AddToListResult> {
    const key = this.keyFor(addr);
    await this.redisClient.sAdd(key, txHash);
    const newLen = await this.redisClient.sCard(key);
    return { ok: true, newValue: newLen };
  }

  /**
   * Removes a transaction hash from the pending list of the given address.
   *
   * @param address - Account address whose pending list should be modified.
   * @param txHash - Transaction hash to remove from the list.
   * @returns The updated number of pending transactions for the address.
   */
  async removeFromList(address: string, txHash: string): Promise<number> {
    const key = this.keyFor(address);
    await this.redisClient.sRem(key, txHash);
    const newLen = await this.redisClient.sCard(key);
    return newLen;
  }

  /**
   * Removes all keys managed by this storage (all `pending:*`).
   *
   * @remarks
   * Iterates keys using `SCAN` via `scanIterator` to avoid blocking Redis, and
   * batches deletions using a pipeline for efficiency.
   */
  async removeAll(): Promise<void> {
    let pipeline = this.redisClient.multi();
    let batched = 0;
    for await (const key of this.redisClient.scanIterator({ MATCH: `${this.keyPrefix}*`, COUNT: 500 })) {
      pipeline.del(key);
      batched++;
      if (batched % 100 === 0) {
        await pipeline.execAsPipeline();
        pipeline = this.redisClient.multi();
      }
    }
    await pipeline.execAsPipeline();
  }

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param addr - Account address to query.
   * @returns The current pending count (0 if the list does not exist).
   */
  async getList(addr: string): Promise<number> {
    const key = this.keyFor(addr);
    const len = await this.redisClient.sCard(key);
    return len;
  }
}
