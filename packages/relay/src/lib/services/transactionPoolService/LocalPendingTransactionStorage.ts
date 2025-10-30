// SPDX-License-Identifier: Apache-2.0

import { PendingTransactionStorage } from '../../types/transactionPool';

/**
 * Local in-memory implementation of PendingTransactionStorage.
 * Uses Map-based storage to track pending transactions without external dependencies.
 *
 * This implementation is thread-safe within a single process but does not provide
 * atomicity across multiple process instances.
 */
export class LocalPendingTransactionStorage implements PendingTransactionStorage {
  // Maps address to a Set of transaction hashes for that address
  private readonly pendingTransactions: Map<string, Set<string>>;

  // Global set of all pending transaction hashes
  private readonly globalTransactionIndex: Set<string>;

  // Maps transaction hash to RLP hex payload
  private readonly transactionPayloads: Map<string, string>;

  constructor() {
    this.pendingTransactions = new Map();
    this.globalTransactionIndex = new Set();
    this.transactionPayloads = new Map();
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
   * Adds a pending transaction entry for the given address.
   * Atomically indexes the transaction (per-address + global) and persists its payload.
   *
   * @param addr - The account address
   * @param txHash - The transaction hash to add to the pending list
   * @param rlpHex - The RLP-encoded transaction as a hex string
   */
  async addToList(addr: string, txHash: string, rlpHex: string): Promise<void> {
    // Initialize the set if it doesn't exist
    if (!this.pendingTransactions.has(addr)) {
      this.pendingTransactions.set(addr, new Set());
    }

    const addressTransactions = this.pendingTransactions.get(addr)!;
    addressTransactions.add(txHash);

    // Persist payload and add to global index
    this.transactionPayloads.set(txHash, rlpHex);
    this.globalTransactionIndex.add(txHash);
  }

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - The account address whose transaction should be removed
   * @param txHash - The transaction hash to remove
   */
  async removeFromList(address: string, txHash: string): Promise<void> {
    const addressTransactions = this.pendingTransactions.get(address);

    if (addressTransactions) {
      addressTransactions.delete(txHash);

      // Clean up empty sets to prevent memory leaks
      if (addressTransactions.size === 0) {
        this.pendingTransactions.delete(address);
      }
    }

    // Remove payload and global index entry
    this.transactionPayloads.delete(txHash);
    this.globalTransactionIndex.delete(txHash);
  }

  /**
   * Removes all pending transactions across all addresses.
   *
   * @returns Promise that resolves once all entries have been cleared
   */
  async removeAll(): Promise<void> {
    this.pendingTransactions.clear();
    this.globalTransactionIndex.clear();
    this.transactionPayloads.clear();
  }

  /**
   * Retrieves the full transaction payload (RLP hex) from storage.
   *
   * @param txHash - The transaction hash to retrieve
   * @returns The RLP hex string, or null if not found
   */
  async getTransactionPayload(txHash: string): Promise<string | null> {
    return this.transactionPayloads.get(txHash) ?? null;
  }

  /**
   * Retrieves multiple transaction payloads (RLP hex) from storage.
   *
   * @param txHashes - Array of transaction hashes to retrieve
   * @returns Array of RLP hex strings (null for missing transactions)
   */
  async getTransactionPayloads(txHashes: string[]): Promise<(string | null)[]> {
    return txHashes.map((hash) => this.transactionPayloads.get(hash) ?? null);
  }

  /**
   * Retrieves all pending transaction hashes across all addresses.
   *
   * @returns Array of all pending transaction hashes
   */
  async getAllTransactionHashes(): Promise<string[]> {
    return Array.from(this.globalTransactionIndex);
  }

  /**
   * Retrieves pending transaction hashes for a specific address.
   *
   * @param address - The account address to query
   * @returns Array of transaction hashes for the address
   */
  async getTransactionHashes(address: string): Promise<string[]> {
    const addressTransactions = this.pendingTransactions.get(address);
    return addressTransactions ? Array.from(addressTransactions) : [];
  }
}
