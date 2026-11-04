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
   * Sorted set of addresses scored by their pending set's expiry, so they can be counted without `KEYS`.
   */
  private readonly activeAddressesKey = `${this.keyPrefix}addresses`;

  /**
   * Key for storing cached count of confirmed transactions.
   */
  private readonly confirmedTxCountKey = `${this.keyPrefix}confirmed`;

  /**
   * Reference TTL baseline in seconds, derived from sdk request timeout.
   * This value is not written as a key TTL by itself; it serves as a base to
   * compute other expirations in this storage (e.g., confirmedCountTtl).
   */
  private readonly referenceStorageTtl: number;

  /**
   * Extra TTL in seconds added per currently pending transaction for an address
   * when computing that address' pending-set expiration.
   */
  private readonly extraPerPendingStorageTtl: number;

  /**
   * Lua script that atomically removes a transaction from the pending pool and, once the address has no
   * pending transactions left, drops it from the active addresses sorted set.
   *
   * - `KEYS[1]`: the per-address pending set.
   * - `KEYS[2]`: the global pending set.
   * - `KEYS[3]`: the active addresses sorted set.
   * - `ARGV[1]`: the RLP-encoded transaction.
   * - `ARGV[2]`: the address.
   *
   * Returns 1 if the transaction was removed, 0 otherwise.
   */
  private static readonly REMOVE_SCRIPT = `
    local removed = redis.call('SREM', KEYS[1], ARGV[1])
    redis.call('SREM', KEYS[2], ARGV[1])
    if redis.call('SCARD', KEYS[1]) == 0 then
      redis.call('ZREM', KEYS[3], ARGV[2])
    end
    return removed
  `;

  /**
   * Lua script that atomically removes a transaction from the pending pool and, only if it was actually
   * removed, increments the address' confirmed count.
   *
   * - `KEYS[1]`: the per-address pending set.
   * - `KEYS[2]`: the global pending set.
   * - `KEYS[3]`: the per-address confirmed count.
   * - `KEYS[4]`: the active addresses sorted set.
   * - `ARGV[1]`: the RLP-encoded transaction.
   * - `ARGV[2]`: the TTL (in seconds) to refresh on the confirmed count.
   * - `ARGV[3]`: the address.
   *
   * The per-address SREM result decides whether this caller is the one that removed the transaction, so of
   * several (possibly concurrent) callers removing the same transaction exactly one increments the count.
   * A missing confirmed count key means it expired way too early - it is not recreated then.
   * Like {@link REMOVE_SCRIPT}, it drops the address from the active addresses sorted set once it has no
   * pending transactions left.
   *
   * Returns 1 if the transaction was removed, 0 otherwise.
   */
  private static readonly REMOVE_AND_INCREMENT_CONFIRMED_SCRIPT = `
    local removed = redis.call('SREM', KEYS[1], ARGV[1])
    redis.call('SREM', KEYS[2], ARGV[1])
    if redis.call('SCARD', KEYS[1]) == 0 then
      redis.call('ZREM', KEYS[4], ARGV[3])
    end
    if removed == 1 and redis.call('EXISTS', KEYS[3]) == 1 then
      redis.call('INCR', KEYS[3])
      redis.call('EXPIRE', KEYS[3], ARGV[2])
    end
    return removed
  `;

  /**
   * Creates a new Redis-backed pending transaction storage.
   *
   * @param redisClient - A connected {@link RedisClientType} instance.
   */
  constructor(private readonly redisClient: RedisClientType) {
    this.referenceStorageTtl = Math.ceil(ConfigService.get('SDK_REQUEST_TIMEOUT') / 1000); // ms to s conversion
    this.extraPerPendingStorageTtl = ConfigService.get('EXTRA_PER_PENDING_TRANSACTION_STORAGE_TTL');
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
    const storageTtl = await this.getPendingTxTtl(address);
    const now = Date.now();

    await this.redisClient
      .multi()
      .sAdd(addressKey, rlpHex)
      .expire(addressKey, storageTtl)
      .sAdd(this.globalPendingTxsKey, rlpHex)
      .expire(this.globalPendingTxsKey, storageTtl)
      .zAdd(this.activeAddressesKey, { score: now + storageTtl * 1000, value: address })
      .zRemRangeByScore(this.activeAddressesKey, '-inf', now)

      .set(confirmedCountKey, confirmedCount, { NX: true }) // set only if not exists
      .expire(confirmedCountKey, this.confirmedCountTtl) // but always refresh ttl

      .exec();
  }

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - Account address whose pending list should be modified.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   * @returns true if the transaction was in the pending list of the address and got removed.
   */
  async removeFromList(address: string, rlpHex: string): Promise<boolean> {
    const result = await this.redisClient.eval(RedisPendingTransactionStorage.REMOVE_SCRIPT, {
      keys: [this.keyFor(address), this.globalPendingTxsKey, this.activeAddressesKey],
      arguments: [rlpHex, address],
    });
    return Number(result) === 1;
  }

  /**
   * Removes a transaction from the pending list of the given address and increments its confirmed count,
   * atomically and only if the transaction was actually removed - removing the same transaction twice
   * (e.g. by the receipt path and the Mirror Node poll, possibly from different relay instances) must not
   * count it twice. See {@link REMOVE_AND_INCREMENT_CONFIRMED_SCRIPT}.
   *
   * @param address - Account address whose pending list should be modified.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   * @returns true if the transaction was in the pending list of the address and got removed.
   */
  async removeFromListAndIncrementConfirmedCount(address: string, rlpHex: string): Promise<boolean> {
    const result = await this.redisClient.eval(RedisPendingTransactionStorage.REMOVE_AND_INCREMENT_CONFIRMED_SCRIPT, {
      keys: [
        this.keyFor(address),
        this.globalPendingTxsKey,
        this.keyFor(address, this.confirmedTxCountKey),
        this.activeAddressesKey,
      ],
      arguments: [rlpHex, String(this.confirmedCountTtl), address],
    });
    return Number(result) === 1;
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
    return await this.redisClient.zCount(this.activeAddressesKey, `(${Date.now()}`, '+inf');
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
   * Retrieves the number of pending transactions across all addresses.
   *
   * @returns The total pending transaction count
   */
  async getAllTransactionCount(): Promise<number> {
    return await this.redisClient.sCard(this.globalPendingTxsKey);
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

  /**
   * TTL for the cached confirmed-transaction count per address, in seconds.
   * Set to 2x the referenceStorageTtl so it outlives the baseline request
   * window and tolerates delays.
   */
  get confirmedCountTtl(): number {
    return 2 * this.referenceStorageTtl;
  }

  /**
   * Computes the TTL (in seconds) to apply to a sender's pending-transaction set.
   * The +1 accounts for the transaction being added now to ensure a minimum bump.
   * Scales with the number of pending transactions to reduce premature expiration
   * under bursty submission patterns - with the nonce ordering mechanism enabled
   * transactions will be submitted one by one.
   *
   * @param address - The account address whose pending list size is used for scaling.
   */
  async getPendingTxTtl(address: string): Promise<number> {
    const pendingCount = await this.getList(address);
    return this.confirmedCountTtl + (1 + pendingCount) * this.extraPerPendingStorageTtl;
  }
}
