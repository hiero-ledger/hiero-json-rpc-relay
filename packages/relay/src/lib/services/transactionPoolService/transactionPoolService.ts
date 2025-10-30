// SPDX-License-Identifier: Apache-2.0

import { Transaction } from 'ethers';
import { Logger } from 'pino';

import {
  PendingTransactionStorage,
  TransactionPoolService as ITransactionPoolService,
} from '../../types/transactionPool';

/**
 * Service implementation that orchestrates pending transaction management.
 * Acts as a facade for the underlying storage layer and coordinates transaction lifecycle.
 */
export class TransactionPoolService implements ITransactionPoolService {
  /**
   * The logger used for logging transaction pool operations.
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * The storage implementation for managing pending transactions.
   *
   * @private
   */
  private readonly storage: PendingTransactionStorage;

  /**
   * Creates a new TransactionPoolService instance.
   *
   * @param storage - The storage backend for pending transactions.
   * @param logger - The logger instance for transaction pool operations.
   */
  constructor(storage: PendingTransactionStorage, logger: Logger) {
    this.storage = storage;
    this.logger = logger.child({ name: 'transaction-pool-service' });
  }

  /**
   * Saves a transaction into the transaction pool for the given address.
   *
   * @param address - The account address that submits the transaction.
   * @param tx - The transaction object to be stored.
   * @returns A promise that resolves once the transaction is stored.
   */
  async saveTransaction(address: string, tx: Transaction): Promise<void> {
    const txHash = tx.hash;
    const addressLowerCased = address.toLowerCase();

    if (!txHash) {
      throw new Error('Transaction hash is required for storage');
    }

    const rlpHex = tx.serialized;
    await this.storage.addToList(addressLowerCased, txHash, rlpHex);

    const rlpBytes = (rlpHex.startsWith('0x') ? rlpHex.length - 2 : rlpHex.length) / 2;
    this.logger.debug({ address, txHash, rlpBytes }, 'Transaction saved to pool');
  }

  /**
   * Removes a specific transaction from the pending pool.
   * This is typically called when a transaction is confirmed or fails on the consensus layer.
   *
   * @param address - The account address of the transaction sender.
   * @param txHash - The hash of the transaction to remove.
   * @returns A promise that resolves to the new pending transaction count for the address.
   */
  async removeTransaction(address: string, txHash: string): Promise<void> {
    const addressLowerCased = address.toLowerCase();

    await this.storage.removeFromList(addressLowerCased, txHash);

    this.logger.debug({ address, txHash }, 'Transaction removed from pool');
  }

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to the number of pending transactions.
   */
  async getPendingCount(address: string): Promise<number> {
    const addressLowerCased = address.toLowerCase();
    return await this.storage.getList(addressLowerCased);
  }

  /**
   * Retrieves all pending transaction hashes and their RLP payloads for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to a map of transaction hash to RLP hex.
   */
  async getTransactions(address: string): Promise<Map<string, string>> {
    const addressLowerCased = address.toLowerCase();
    const transactionMap = new Map<string, string>();

    const hashes = await this.storage.getTransactionHashes(addressLowerCased);

    if (hashes.length === 0) {
      return transactionMap;
    }

    const payloads = await this.storage.getTransactionPayloads(hashes);

    let validCount = 0;
    let nullCount = 0;

    for (let i = 0; i < hashes.length; i++) {
      const payload = payloads[i];
      if (payload !== null) {
        transactionMap.set(hashes[i], payload);
        validCount++;
      } else {
        nullCount++;
      }
    }

    this.logger.debug(
      { address, totalHashes: hashes.length, validPayloads: validCount, nullPayloads: nullCount },
      'Retrieved transactions for address',
    );

    return transactionMap;
  }

  /**
   * Retrieves all pending transactions across all addresses.
   * Returns a map of transaction hash to RLP hex.
   *
   * @returns A promise that resolves to a map of transaction hash to RLP hex.
   */
  async getAllTransactions(): Promise<Map<string, string>> {
    const transactionMap = new Map<string, string>();

    if (!this.storage.getAllTransactionHashes || !this.storage.getTransactionPayloads) {
      this.logger.debug('Storage does not support global transaction retrieval');
      return transactionMap;
    }

    const startTime = Date.now();

    const hashes = await this.storage.getAllTransactionHashes();

    if (hashes.length === 0) {
      return transactionMap;
    }

    const payloads = await this.storage.getTransactionPayloads(hashes);

    let validCount = 0;
    let nullCount = 0;

    for (let i = 0; i < hashes.length; i++) {
      const payload = payloads[i];
      if (payload !== null) {
        transactionMap.set(hashes[i], payload);
        validCount++;
      } else {
        nullCount++;
      }
    }

    const duration = Date.now() - startTime;

    this.logger.debug(
      {
        totalHashes: hashes.length,
        validPayloads: validCount,
        nullPayloads: nullCount,
        durationMs: duration,
      },
      'Retrieved all transactions from pool',
    );

    return transactionMap;
  }
}
