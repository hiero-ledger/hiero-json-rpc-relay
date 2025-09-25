// SPDX-License-Identifier: Apache-2.0

import { AddToListResult, PendingTransactionStorage } from '../../types/transactionPool';

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

  // Maps transaction hash to RLP-encoded transaction data (for future use)
  private readonly transactionData: Map<string, string>;

  constructor() {
    this.pendingTransactions = new Map();
    this.transactionData = new Map();
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
   * Attempts to add a pending transaction entry for the given address.
   *
   * This implementation checks that the current pending count matches the expected count
   * before adding a new entry, providing optimistic concurrency control.
   *
   * @param addr - The account address
   * @param txHash - The transaction hash to add to the pending list
   * @param expectedPending - The expected number of pending transactions before addition
   * @returns Promise resolving to AddToListResult indicating success or failure
   */
  async addToList(addr: string, txHash: string, expectedPending: number): Promise<AddToListResult> {
    const currentCount = await this.getList(addr);

    // Check if the current count matches expectations (optimistic concurrency control)
    if (currentCount !== expectedPending) {
      return { ok: false, current: currentCount };
    }

    // Initialize the set if it doesn't exist
    if (!this.pendingTransactions.has(addr)) {
      this.pendingTransactions.set(addr, new Set());
    }

    const addressTransactions = this.pendingTransactions.get(addr)!;
    addressTransactions.add(txHash);

    return { ok: true, newValue: addressTransactions.size };
  }

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - The account address whose transaction should be removed
   * @param txHash - The transaction hash to remove
   * @returns Promise resolving to the updated pending count
   */
  async removeFromList(address: string, txHash: string): Promise<number> {
    const addressTransactions = this.pendingTransactions.get(address);

    if (addressTransactions) {
      addressTransactions.delete(txHash);

      // Clean up empty sets to prevent memory leaks
      if (addressTransactions.size === 0) {
        this.pendingTransactions.delete(address);
      }
    }

    // Also remove from transaction data map
    this.transactionData.delete(txHash);

    return addressTransactions ? addressTransactions.size : 0;
  }

  /**
   * Removes all pending transactions across all addresses.
   *
   * @returns Promise that resolves once all entries have been cleared
   */
  async removeAll(): Promise<void> {
    this.pendingTransactions.clear();
    this.transactionData.clear();
  }
}
