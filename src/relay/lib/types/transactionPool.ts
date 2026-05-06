// SPDX-License-Identifier: Apache-2.0

import { type Transaction } from 'ethers/transaction';

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
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   * @param status - Status of the transaction
   * @returns A promise that resolves to the new pending transaction count for the address.
   */
  removeTransaction(address: string, rlpHex: string, status?: 'rejected' | 'confirmed'): Promise<void>;

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param address - The account address to query.
   * @param fallbackValue - When provided, returns this value instead of throwing on storage errors.
   *                        When undefined (default), errors propagate to the caller.
   * @returns A promise that resolves to the number of pending transactions.
   */
  getPendingCount(address: string, fallbackValue?: number): Promise<number>;

  /**
   * Retrieves all pending transaction RLP payloads for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to a Set of RLP hex strings.
   */
  getTransactions(address: string): Promise<Set<string>>;

  /**
   * Retrieves all pending transaction RLP payloads across all addresses.
   *
   * @returns A promise that resolves to a Set of RLP hex strings.
   */
  getAllTransactions(): Promise<Set<string>>;

  /**
   * Returns the cached value holding the sender's initial nonce baseline
   * obtained from the mirror node for the first transaction in a burst, or null if absent.
   * Note: this value is a baseline and is not updated as subsequent transactions are processed.
   */
  getConfirmedCount(address: string): Promise<number | null>;
}

/**
 * Storage layer for managing pending transaction's metadata.
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
   * Retrieves the number of unique addresses with pending transactions.
   *
   * @returns A promise that resolves to the number of unique addresses.
   */
  getUniqueAddressCount(): Promise<number>;

  /**
   * Adds a pending transaction for the given address.
   * Implementations must atomically index the transaction (per-address + global) and persist its payload.
   *
   * @param addr - The account address.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   * @param confirmedCount - The confirmed transaction count for the address.
   */
  addToList(addr: string, rlpHex: string, confirmedCount: number): Promise<void>;

  /**
   * Removes a transaction from the pending list of the given address.
   * If the transaction is confirmed, it should increase the confirmed count by 1.
   *
   * @param address - The account address whose transaction should be removed.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   * @param status - The status of the transaction (optional).
   */
  removeFromList(address: string, rlpHex: string, status?: 'rejected' | 'confirmed'): Promise<void>;

  /**
   * Removes all pending transactions across all addresses.
   *
   * @returns A promise that resolves once all entries have been cleared.
   */
  removeAll(): Promise<void>;

  /**
   * Retrieves all pending transaction payloads (RLP hex) across all addresses.
   *
   * @returns Set of all pending transaction RLP hex strings.
   */
  getAllTransactionPayloads(): Promise<Set<string>>;

  /**
   * Retrieves pending transaction payloads (RLP hex) for a specific address.
   *
   * @param address - The account address to query.
   * @returns Set of transaction RLP hex strings for the address.
   */
  getTransactionPayloads(address: string): Promise<Set<string>>;

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
  getConfirmedCount(address: string): Promise<number | null>;
}
