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
   * Prefix for transaction payload keys.
   */
  private readonly txKeyPrefix = 'tx:';

  /**
   * Key for the global pending transactions index.
   */
  private readonly globalIndexKey = 'pending:txns';

  /**
   * The time-to-live (TTL) for the pending transaction storage in seconds.
   */
  private readonly storageTtl: number;

  /**
   * Batch size for MGET operations when fetching multiple transaction payloads.
   */
  private readonly mgetBatchSize: number;

  /**
   * Lua script to get all transaction hashes and clean up orphaned entries.
   * Returns only hashes that have valid payloads in Redis.
   *
   * KEYS[1] = global index key (e.g., "pending:txns")
   * KEYS[2] = transaction key prefix (e.g., "tx:")
   */
  private static readonly LUA_GET_ALL_HASHES_AND_CLEAN = `
    local globalKey = KEYS[1]
    local txPrefix = KEYS[2]
    
    local allHashes = redis.call('SMEMBERS', globalKey)
    local validHashes = {}
    local orphanedHashes = {}
    
    for i, hash in ipairs(allHashes) do
      local txKey = txPrefix .. hash
      local exists = redis.call('EXISTS', txKey)
      
      if exists == 1 then
        table.insert(validHashes, hash)
      else
        table.insert(orphanedHashes, hash)
      end
    end
    
    -- Remove orphaned hashes from global index
    if #orphanedHashes > 0 then
      redis.call('SREM', globalKey, unpack(orphanedHashes))
    end
    
    return validHashes
  `;

  /**
   * Lua script to get transaction hashes for an address and clean up orphaned entries.
   * Returns only hashes that have valid payloads in Redis.
   *
   * KEYS[1] = address key (e.g., "pending:0x123...")
   * KEYS[2] = global index key (e.g., "pending:txns")
   * KEYS[3] = transaction key prefix (e.g., "tx:")
   */
  private static readonly LUA_GET_ADDRESS_HASHES_AND_CLEAN = `
    local addressKey = KEYS[1]
    local globalKey = KEYS[2]
    local txPrefix = KEYS[3]
    
    local hashes = redis.call('SMEMBERS', addressKey)
    local validHashes = {}
    local orphanedHashes = {}
    
    for i, hash in ipairs(hashes) do
      local txKey = txPrefix .. hash
      local exists = redis.call('EXISTS', txKey)
      
      if exists == 1 then
        table.insert(validHashes, hash)
      else
        table.insert(orphanedHashes, hash)
      end
    end
    
    -- Remove orphaned hashes from both address set and global index
    if #orphanedHashes > 0 then
      for i, hash in ipairs(orphanedHashes) do
        redis.call('SREM', addressKey, hash)
        redis.call('SREM', globalKey, hash)
      end
    end
    
    return validHashes
  `;

  /**
   * Creates a new Redis-backed pending transaction storage.
   *
   * @param redisClient - A connected {@link RedisClientType} instance.
   * @param storageTtl - Optional TTL in seconds for transaction payloads (defaults to constant).
   * @param mgetBatchSize - Optional batch size for MGET operations (defaults to constant).
   */
  constructor(
    private readonly redisClient: RedisClientType,
    storageTtl?: number,
    mgetBatchSize?: number,
  ) {
    this.storageTtl = storageTtl ?? constants.TRANSACTION_POOL_STORAGE_TTL_SECONDS;
    this.mgetBatchSize = mgetBatchSize ?? constants.TRANSACTION_POOL_MGET_BATCH_SIZE;
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
   * Resolves the Redis key for a transaction payload.
   *
   * @param txHash - Transaction hash.
   * @returns The Redis key (e.g., `tx:<hash>`).
   */
  private txKeyFor(txHash: string): string {
    return `${this.txKeyPrefix}${txHash}`;
  }

  /**
   * Adds a pending transaction for the given address.
   * Atomically indexes the transaction (per-address + global) and persists its payload using MULTI/EXEC.
   *
   * @param address - Account address whose pending list will be appended to.
   * @param txHash - Transaction hash to append.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   */
  async addToList(address: string, txHash: string, rlpHex: string): Promise<void> {
    const addressKey = this.keyFor(address);
    const txKey = this.txKeyFor(txHash);

    await this.redisClient
      .multi()
      .sAdd(addressKey, txHash)
      .expire(addressKey, this.storageTtl)
      .sAdd(this.globalIndexKey, txHash)
      .set(txKey, rlpHex, { EX: this.storageTtl })
      .exec();
  }

  /**
   * Removes a transaction hash from the pending list of the given address.
   *
   * @param address - Account address whose pending list should be modified.
   * @param txHash - Transaction hash to remove from the list.
   */
  async removeFromList(address: string, txHash: string): Promise<void> {
    const key = this.keyFor(address);
    const txKey = this.txKeyFor(txHash);
    await this.redisClient.multi().sRem(key, txHash).sRem(this.globalIndexKey, txHash).unlink(txKey).execAsPipeline();
  }

  /**
   * Removes all keys managed by this storage (all `txpool:pending:*`).
   */
  async removeAll(): Promise<void> {
    const pendingKeys = await this.redisClient.keys(`${this.keyPrefix}*`);
    const txKeys = await this.redisClient.keys(`${this.txKeyPrefix}*`);

    const allKeys = [...pendingKeys, ...txKeys];

    if (allKeys.length > 0) {
      await this.redisClient.unlink(allKeys);
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
   * Retrieves the full transaction payload (RLP hex) from storage.
   *
   * @param txHash - The transaction hash to retrieve
   * @returns The RLP hex string, or null if not found
   */
  async getTransactionPayload(txHash: string): Promise<string | null> {
    const txKey = this.txKeyFor(txHash);
    return await this.redisClient.get(txKey);
  }

  /**
   * Retrieves multiple transaction payloads (RLP hex) from storage.
   * Batches requests to avoid overwhelming Redis with large MGET operations.
   *
   * @param txHashes - Array of transaction hashes to retrieve
   * @returns Array of RLP hex strings (null for missing transactions)
   */
  async getTransactionPayloads(txHashes: string[]): Promise<(string | null)[]> {
    if (txHashes.length === 0) {
      return [];
    }

    const results: (string | null)[] = [];

    // Process in batches to avoid overwhelming Redis
    for (let i = 0; i < txHashes.length; i += this.mgetBatchSize) {
      const batch = txHashes.slice(i, i + this.mgetBatchSize);
      const keys = batch.map((hash) => this.txKeyFor(hash));

      const batchResults = await this.redisClient.mGet(keys);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Retrieves all pending transaction hashes across all addresses.
   * Self-heals by removing hashes whose payloads have expired.
   * Uses Lua script for atomic operation and better performance.
   *
   * @returns Array of all pending transaction hashes
   */
  async getAllTransactionHashes(): Promise<string[]> {
    const validHashes = (await this.redisClient.eval(RedisPendingTransactionStorage.LUA_GET_ALL_HASHES_AND_CLEAN, {
      keys: [this.globalIndexKey, this.txKeyPrefix],
      arguments: [],
    })) as string[];

    return validHashes;
  }

  /**
   * Retrieves pending transaction hashes for a specific address.
   * Self-heals by removing hashes whose payloads have expired.
   * Uses Lua script for atomic operation and better performance.
   *
   * @param address - The account address to query
   * @returns Array of transaction hashes for the address
   */
  async getTransactionHashes(address: string): Promise<string[]> {
    const addressKey = this.keyFor(address);

    const validHashes = (await this.redisClient.eval(RedisPendingTransactionStorage.LUA_GET_ADDRESS_HASHES_AND_CLEAN, {
      keys: [addressKey, this.globalIndexKey, this.txKeyPrefix],
      arguments: [],
    })) as string[];

    return validHashes;
  }
}
