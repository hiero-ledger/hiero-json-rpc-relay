// SPDX-License-Identifier: Apache-2.0

import { Transaction } from 'ethers';

import { IExecuteTransactionEventPayload } from './events';

/**
 * Result of attempting to add a transaction to the pending list.
 *
 * This type provides information about whether the operation succeeded and the resulting state is as following:
 * - `{ ok: true; newValue: number }` — The transaction was added successfully and the new pending count is returned.
 * - `{ ok: false; current: number }` — The transaction was not added and the current pending count is returned.
 */
export type AddToListResult = { ok: true; newValue: number } | { ok: false; current: number };

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
   * Handles consensus results and updates the pool state accordingly.
   *
   * @param payload - The transaction execution event payload containing transaction details.
   * @returns A promise that resolves when the consensus result has been received.
   */
  onConsensusResult(payload: IExecuteTransactionEventPayload): Promise<void>;

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to the number of pending transactions.
   */
  getPendingCount(address: string): Promise<number>;

  /**
   * Clears the transaction pool state (on application restart or crash).
   *
   * @returns A promise that resolves once the state has been reset.
   */
  resetState(): Promise<void>;
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
   * @returns A promise that resolves to an {@link AddToListResult}.
   */
  addToList(addr: string, txHash: string): Promise<AddToListResult>;

  /**
   * Removes a transaction from the pending list of the given address.
   *
   * @param address - The account address whose transaction should be removed.
   * @param txHash - The transaction hash to remove.
   * @returns A promise that resolves to the updated pending count.
   */
  removeFromList(address: string, txHash: string): Promise<number>;

  /**
   * Removes all pending transactions across all addresses.
   *
   * @returns A promise that resolves once all entries have been cleared.
   */
  removeAll(): Promise<void>;
}
