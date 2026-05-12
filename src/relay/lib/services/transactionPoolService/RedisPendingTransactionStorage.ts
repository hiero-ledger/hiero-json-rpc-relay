// SPDX-License-Identifier: Apache-2.0
import { type RedisClientType } from 'redis';

import { ConfigService } from '../../../../config-service/services';
import { type PendingTransactionStorage } from '../../types/transactionPool';

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
   * Key for storing cached count of confirmed transactions.
   */
  private readonly confirmedTxCountKey = `${this.keyPrefix}confirmed`;

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
   * @param address - Account address whose pending list key should be derived.
   * @param prefix - Optional prefix to prepend to the key (default: `this.keyPrefix`).
   * @returns The Redis key (e.g., `txpool:pending:<address>`).
   */
  private keyFor(address: string, prefix = this.keyPrefix): string {
    return `${prefix}${address}`;
  }

  /**
   * Adds a pending transaction for the given address.
   * Atomically indexes the transaction (per-address + global) using MULTI/EXEC.
   * It also stores the confirmed count for the address.
   *
   * @param address - Account address whose pending list will be appended to.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   * @param confirmedCount - The number of confirmed transactions for this address.
   */
  async addToListAndSetConfirmedCount(address: string, rlpHex: string, confirmedCount: number): Promise<void> {
    const addressKey = this.keyFor(address);
    const confirmedCountKey = this.keyFor(address, this.confirmedTxCountKey);

    await this.redisClient
      .multi()
      .sAdd(addressKey, rlpHex)
      .expire(addressKey, this.storageTtl)
      .sAdd(this.globalPendingTxsKey, rlpHex)
      .expire(this.globalPendingTxsKey, this.storageTtl)

      .set(confirmedCountKey, confirmedCount, { NX: true }) // set only if not exists
      .expire(confirmedCountKey, ConfigService.get('CACHED_SENDER_TX_COUNT_TTL')) // but always refresh ttl

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
   * Removes a transaction from the pending list of the given address.
   * If the transaction is confirmed, it should increase the confirmed count by 1.
   *
   * @param address - Account address whose pending list should be modified.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   */
  async removeFromListAndIncrementConfirmedCount(address: string, rlpHex: string): Promise<void> {
    const confirmedKey = this.keyFor(address, this.confirmedTxCountKey);

    // MULTI will still execute even if the pending tx set already expired.
    // This is expected behavior.
    //
    // If the tx is no longer in the pending pool, SREM becomes a no-op.
    // We still attempt to increment the confirmed count if that key exists.
    const multi = this.redisClient.multi().sRem(this.keyFor(address), rlpHex).sRem(this.globalPendingTxsKey, rlpHex);

    // If the key is missing it means that confirmed count expired way too early, we shouldn't set it then
    const confirmedCountExists = await this.redisClient.exists(confirmedKey);
    if (confirmedCountExists)
      multi.incr(confirmedKey).expire(confirmedKey, ConfigService.get('CACHED_SENDER_TX_COUNT_TTL'));
    await multi.exec();
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
   * Retrieves the number of unique addresses with pending transactions.
   *
   * @returns Promise resolving to the count of unique addresses in the pending pool.
   */
  async getUniqueAddressCount(): Promise<number> {
    const keys = await this.redisClient.keys(`${this.keyPrefix}*`);
    return keys.filter((k) => k !== this.globalPendingTxsKey).length;
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

  /**
   * Returns the cached sender's initial nonce baseline
   * as returned by the mirror node for the first transaction in a burst; returns null if absent
   * or if no cache service is configured.
   *
   * Notes:
   * - This cache does NOT track the evolving expected nonce; it only stores the initial baseline.
   * - Callers should derive subsequent expected nonces relative to this value.
   *
   * @param address - The sender's EVM address.
   */
  async getConfirmedCount(address: string): Promise<number | null> {
    const result = await this.redisClient.get(this.keyFor(address, this.confirmedTxCountKey));
    return result != null ? Number(result) : null;
  }
}
