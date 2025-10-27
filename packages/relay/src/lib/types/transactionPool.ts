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

  /**
   * Retrieves all pending transaction hashes and their RLP payloads for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to a map of transaction hash to RLP hex.
   */
  getTransactions(address: string): Promise<Map<string, string>>;

  /**
   * Retrieves all pending transactions across all addresses.
   *
   * @returns A promise that resolves to a map of transaction hash to RLP hex.
   */
  getAllTransactions(): Promise<Map<string, string>>;
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

  /**
   * Saves the full transaction payload (RLP hex) to storage.
   *
   * @param txHash - The transaction hash (key).
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   */
  saveTransactionPayload(txHash: string, rlpHex: string): Promise<void>;

  /**
   * Retrieves the full transaction payload (RLP hex) from storage.
   *
   * @param txHash - The transaction hash to retrieve.
   * @returns The RLP hex string, or null if not found.
   */
  getTransactionPayload(txHash: string): Promise<string | null>;

  /**
   * Retrieves multiple transaction payloads (RLP hex) from storage.
   *
   * @param txHashes - Array of transaction hashes to retrieve.
   * @returns Array of RLP hex strings (null for missing transactions).
   */
  getTransactionPayloads(txHashes: string[]): Promise<(string | null)[]>;

  /**
   * Removes the full transaction payload from storage.
   *
   * @param txHash - The transaction hash to remove.
   */
  removeTransactionPayload(txHash: string): Promise<void>;

  /**
   * Retrieves all pending transaction hashes across all addresses.
   *
   * @returns Array of all pending transaction hashes.
   */
  getAllTransactionHashes(): Promise<string[]>;

  /**
   * Retrieves pending transaction hashes for a specific address.
   *
   * @param address - The account address to query.
   * @returns Array of transaction hashes for the address.
   */
  getTransactionHashes(address: string): Promise<string[]>;
}
