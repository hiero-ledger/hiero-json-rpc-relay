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

    await this.storage.addToList(addressLowerCased, txHash);

    this.logger.debug({ address, txHash }, 'Transaction saved to pool');
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
   * Clears the transaction pool state (typically called on application restart).
   *
   * @returns A promise that resolves once the state has been reset.
   */
  async resetState(): Promise<void> {
    this.logger.info('Resetting transaction pool state');

    await this.storage.removeAll();

    this.logger.info('Transaction pool state successfully reset');
  }
}
