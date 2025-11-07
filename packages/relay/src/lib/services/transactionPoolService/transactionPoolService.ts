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
    const addressLowerCased = address.toLowerCase();
    const rlpHex = tx.serialized;

    try {
      await this.storage.addToList(addressLowerCased, rlpHex);
      this.logger.debug({ address, rlpHex: rlpHex.substring(0, 20) + '...' }, 'Transaction saved to pool');
    } catch (error) {
      this.logger.error(
        { address, error: (error as Error).message, rlpHex: rlpHex.substring(0, 20) + '...' },
        'Failed to save transaction to pool',
      );
      throw error;
    }
  }

  /**
   * Removes a specific transaction from the pending pool.
   * This is typically called when a transaction is confirmed or fails on the consensus layer.
   *
   * @param address - The account address of the transaction sender.
   * @param rlpHex - The RLP-encoded transaction as a hex string.
   * @returns A promise that resolves to the new pending transaction count for the address.
   */
  async removeTransaction(address: string, rlpHex: string): Promise<void> {
    const addressLowerCased = address.toLowerCase();

    try {
      await this.storage.removeFromList(addressLowerCased, rlpHex);
      this.logger.debug({ address, rlpHex: rlpHex.substring(0, 20) + '...' }, 'Transaction removed from pool');
    } catch (error) {
      this.logger.error(
        { address, error: (error as Error).message, rlpHex: rlpHex.substring(0, 20) + '...' },
        'Failed to remove transaction from pool',
      );
      throw error;
    }
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
   * Retrieves all pending transaction RLP payloads for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to a Set of RLP hex strings.
   */
  async getTransactions(address: string): Promise<Set<string>> {
    const addressLowerCased = address.toLowerCase();
    const payloads = await this.storage.getTransactionPayloads(addressLowerCased);

    this.logger.debug({ address, totalPayloads: payloads.size }, 'Retrieved transactions for address');

    return payloads;
  }

  /**
   * Retrieves all pending transaction RLP payloads across all addresses.
   *
   * @returns A promise that resolves to a Set of RLP hex strings.
   */
  async getAllTransactions(): Promise<Set<string>> {
    const payloads = await this.storage.getAllTransactionPayloads();

    return payloads;
  }
}
