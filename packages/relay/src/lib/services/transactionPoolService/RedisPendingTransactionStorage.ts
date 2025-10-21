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
  private keyFor(address: string): string {
    return `${this.keyPrefix}${address}`;
  }

  /**
   * Appends a transaction hash to the pending list for the provided address.
   *
   * @remarks
   * This uses Redis `SADD`, which is atomic. The integer result from Redis is
   * the new length of the list after the append.
   *
   * @param addr - Account address whose pending list will be appended to.
   * @param txHash - Transaction hash to append.
   * @returns Result indicating success and the new list length.
   */
  async addToList(address: string, txHash: string): Promise<AddToListResult> {
    const key = this.keyFor(address);
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

    return await this.redisClient.sCard(key);
  }

  /**
   * Removes all keys managed by this storage (all `pending:*`).
   */
  async removeAll(): Promise<void> {
    const keys = await this.redisClient.keys('pending:');

    if (keys.length > 0) {
      for (const key of keys) {
        this.redisClient.unlink(key);
      }
    }
  }

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param addr - Account address to query.
   * @returns The current pending count (0 if the list does not exist).
   */
  async getList(address: string): Promise<number> {
    const key = this.keyFor(address);

    return await this.redisClient.sCard(key);
  }
}
