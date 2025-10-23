// SPDX-License-Identifier: Apache-2.0

import { Transaction } from 'ethers';

/**
 * Service responsible for managing pending transactions in the pool and coordinating with consensus results.
 */
export interface TransactionPoolService {
  /**
   * Saves a transaction into the transaction pool for the given address.
   *
   * @param address - The account address that submits the transaction.
   * @param tx - The transaction object to be stored.
   * @returns A promise that resolves once the transaction is stored.
   */
  saveTransaction(address: string, tx: Transaction): Promise<void>;

  /**
   * Removes a transaction from the transaction pool for the given address.
   *
   * @param address - The account address that submitted the transaction.
   * @param txHash - The hash of the transaction to remove.
   * @returns A promise that resolves to the new pending transaction count for the address.
   */
  removeTransaction(address: string, txHash: string): Promise<void>;

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to the number of pending transactions.
   */
  getPendingCount(address: string): Promise<number>;
}

/**
 * Storage layer for managing pending transactions metadata.
 */
export interface PendingTransactionStorage {
  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param addr - The account address to look up.
   * @returns A promise that resolves to the pending transaction count.
   */
  getList(addr: string): Promise<number>;

  /**
   * Attempts to add a pending transaction entry for the given address.
   *
   * @param addr - The account address.
   * @param txHash - The transaction hash to add to the pending list.
   */
  addToList(addr: string, txHash: string): Promise<void>;

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - The account address whose transaction should be removed.
   * @param txHash - The transaction hash to remove.
   */
  removeFromList(address: string, txHash: string): Promise<void>;

  /**
   * Removes all pending transactions across all addresses.
   *
   * @returns A promise that resolves once all entries have been cleared.
   */
  removeAll(): Promise<void>;
}
