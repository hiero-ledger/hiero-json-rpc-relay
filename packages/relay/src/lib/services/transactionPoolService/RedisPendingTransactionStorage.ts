// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { RedisClientType } from 'redis';

import constants from '../../constants';
import { PendingTransactionStorage } from '../../types/transactionPool';

export class RedisPendingTransactionStorage implements PendingTransactionStorage {
  /**
   * Prefix used to namespace all keys managed by this storage.
   *
   * @remarks
   * Using a prefix allows efficient scanning and cleanup of related keys.
   * Uses 'txpool:pending:' to distinguish from other transaction pool states
   * (e.g., future 'txpool:queue:').
   */
  private readonly keyPrefix = 'txpool:pending:';

  /**
   * Key for storing all pending transactions across all addresses.
   *
   * @remarks
   * This global set contains all pending transaction RLPs from all addresses,
   * allowing efficient retrieval of the entire pending pool without scanning
   * individual address keys.
   */
  private readonly globalPendingTxsKey = `${this.keyPrefix}global`;

  /**
   * The time-to-live (TTL) for the pending transaction storage in seconds.
   */
  private readonly storageTtl: number;

  /**
   * Creates a new Redis-backed pending transaction storage.
   *
   * @param redisClient - A connected {@link RedisClientType} instance.
   */
  constructor(private readonly redisClient: RedisClientType) {
    this.storageTtl = ConfigService.get('PENDING_TRANSACTION_STORAGE_TTL');
  }

  /**
   * Resolves the Redis key for a given address.
   *
   * @param addr - Account address whose pending list key should be derived.
   * @returns The Redis key (e.g., `txpool:pending:<address>`).
   */
  private keyFor(address: string): string {
    return `${this.keyPrefix}${address}`;
  }

  /**
   * Adds a pending transaction for the given address.
   * Atomically indexes the transaction (per-address + global) using MULTI/EXEC.
   *
   * @param address - Account address whose pending list will be appended to.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   */
  async addToList(address: string, rlpHex: string): Promise<void> {
    const addressKey = this.keyFor(address);

    await this.redisClient
      .multi()
      .sAdd(addressKey, rlpHex)
      .expire(addressKey, this.storageTtl)
      .sAdd(this.globalPendingTxsKey, rlpHex)
      .expire(this.globalPendingTxsKey, this.storageTtl)
      .exec();
  }

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - Account address whose pending list should be modified.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   */
  async removeFromList(address: string, rlpHex: string): Promise<void> {
    const key = this.keyFor(address);
    await this.redisClient.multi().sRem(key, rlpHex).sRem(this.globalPendingTxsKey, rlpHex).exec();
  }

  /**
   * Removes all keys managed by this storage (all `txpool:pending:*`).
   */
  async removeAll(): Promise<void> {
    const pendingKeys = await this.redisClient.keys(`${this.keyPrefix}*`);

    if (pendingKeys.length > 0) {
      await this.redisClient.unlink(pendingKeys);
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

  /**
   * Retrieves all pending transaction payloads (RLP hex) across all addresses.
   *
   * @returns Set of all pending transaction RLP hex strings
   */
  async getAllTransactionPayloads(): Promise<Set<string>> {
    const members = await this.redisClient.sMembers(this.globalPendingTxsKey);
    return new Set(members);
  }

  /**
   * Retrieves pending transaction payloads (RLP hex) for a specific address.
   *
   * @param address - The account address to query
   * @returns Set of transaction RLP hex strings for the address
   */
  async getTransactionPayloads(address: string): Promise<Set<string>> {
    const addressKey = this.keyFor(address);
    const members = await this.redisClient.sMembers(addressKey);
    return new Set(members);
  }
}
