// SPDX-License-Identifier: Apache-2.0

import { type PendingTransactionStorage } from '../../types/transactionPool';

/**
 * Local in-memory implementation of PendingTransactionStorage.
 * Uses Map-based storage to track pending transactions without external dependencies.
 *
 * This implementation is thread-safe within a single process but does not provide
 * atomicity across multiple process instances.
 */
export class LocalPendingTransactionStorage implements PendingTransactionStorage {
  // Local cache of confirmed count for each address
  private readonly confirmedCount: Map<string, number>;

  // Maps address to a Set of RLP hex payloads for that address
  private readonly pendingTransactions: Map<string, Set<string>>;

  // Global set of all pending RLP hex payloads
  private readonly globalTransactionIndex: Set<string>;

  constructor() {
    this.confirmedCount = new Map();
    this.pendingTransactions = new Map();
    this.globalTransactionIndex = new Set();
  }

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param addr - The account address to query
   * @returns Promise resolving to the number of pending transactions
   */
  async getList(addr: string): Promise<number> {
    const addressTransactions = this.pendingTransactions.get(addr);
    return addressTransactions ? addressTransactions.size : 0;
  }

  /**
   * Retrieves the number of unique addresses with pending transactions.
   *
   * @returns Promise resolving to the count of unique addresses in the pending pool.
   */
  async getUniqueAddressCount(): Promise<number> {
    return this.pendingTransactions.size;
  }

  /**
   * Adds a pending transaction entry for the given address.
   * Atomically indexes the transaction (per-address + global) and persists its payload.
   *
   * @param addr - The account address
   * @param rlpHex - The RLP-encoded transaction as a hex string
   * @param confirmedCount - The number of confirmed transactions for this address
   */
  async addToListAndSetConfirmedCount(addr: string, rlpHex: string, confirmedCount: number): Promise<void> {
    // Initialize the set if it doesn't exist
    if (!this.pendingTransactions.has(addr)) {
      this.pendingTransactions.set(addr, new Set());
    }
    if (!this.confirmedCount.has(addr)) this.confirmedCount.set(addr, confirmedCount);

    const addressTransactions = this.pendingTransactions.get(addr)!;
    addressTransactions.add(rlpHex);

    // Add to global index
    this.globalTransactionIndex.add(rlpHex);
  }

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - The account address whose transaction should be removed
   * @param rlpHex - The RLP-encoded transaction as a hex string
   */
  async removeFromList(address: string, rlpHex: string): Promise<void> {
    const addressTransactions = this.pendingTransactions.get(address);

    if (addressTransactions) {
      addressTransactions.delete(rlpHex);

      // Clean up empty sets to prevent memory leaks
      if (addressTransactions.size === 0) {
        this.pendingTransactions.delete(address);
      }
    }

    // Remove from global index
    this.globalTransactionIndex.delete(rlpHex);
  }

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - The account address whose transaction should be removed
   * @param rlpHex - The RLP-encoded transaction as a hex string
   */
  async removeFromListAndIncrementConfirmedCount(address: string, rlpHex: string): Promise<void> {
    await this.removeFromList(address, rlpHex);
    this.confirmedCount.set(address, (this.confirmedCount.get(address) ?? 0) + 1);
  }

  /**
   * Removes all pending transactions across all addresses.
   *
   * @returns Promise that resolves once all entries have been cleared
   */
  async removeAll(): Promise<void> {
    this.pendingTransactions.clear();
    this.globalTransactionIndex.clear();
  }

  /**
   * Retrieves all pending transaction payloads (RLP hex) across all addresses.
   *
   * @returns Set of all pending transaction RLP hex strings
   */
  async getAllTransactionPayloads(): Promise<Set<string>> {
    return this.globalTransactionIndex;
  }

  /**
   * Retrieves pending transaction payloads (RLP hex) for a specific address.
   *
   * @param address - The account address to query
   * @returns Set of transaction RLP hex strings for the address
   */
  async getTransactionPayloads(address: string): Promise<Set<string>> {
    const addressTransactions = this.pendingTransactions.get(address);
    return addressTransactions ?? new Set();
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
    return this.confirmedCount.get(address) ?? null;
  }
}
