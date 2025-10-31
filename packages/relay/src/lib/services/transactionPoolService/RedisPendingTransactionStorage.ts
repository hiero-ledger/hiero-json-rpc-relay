// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { RedisClientType } from 'redis';

import { PendingTransactionStorage } from '../../types/transactionPool';

export class RedisPendingTransactionStorage implements PendingTransactionStorage {
  /**
   * Prefix used to namespace all keys managed by this storage.
   *
   * @remarks
   * Using a prefix allows efficient scanning and cleanup of related keys
   */
  private readonly keyPrefix = 'pending:';

  /**
   * The time-to-live (TTL) for the pending transaction storage in seconds.
   */
  private readonly storageTtl = ConfigService.get('PENDING_TRANSACTION_STORAGE_TTL');

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
   * @returns The new pending transaction count after the addition.
   */
  async addToList(address: string, txHash: string): Promise<void> {
    const key = this.keyFor(address);

    // doing this to be able to atomically add the transaction hash
    // and set the expiration time
    await this.redisClient.multi().sAdd(key, txHash).expire(key, this.storageTtl).execAsPipeline();
  }

  /**
   * Removes a transaction hash from the pending list of the given address.
   *
   * @param address - Account address whose pending list should be modified.
   * @param txHash - Transaction hash to remove from the list.
   */
  async removeFromList(address: string, txHash: string): Promise<void> {
    const key = this.keyFor(address);

    await this.redisClient.sRem(key, txHash);
  }

  async getPendingTransactions(address: string): Promise<Set<string>> {
    const key = this.keyFor(address);
    const members = await this.redisClient.sMembers(key);
    return new Set(members);
  }

  /**
   * Removes all keys managed by this storage (all `pending:*`).
   */
  async removeAll(): Promise<void> {
    const keys = await this.redisClient.keys(`${this.keyPrefix}*`);

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
