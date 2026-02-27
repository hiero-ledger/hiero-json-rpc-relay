// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Transaction } from 'ethers';
import { Logger } from 'pino';
import { Counter, Gauge, Registry } from 'prom-client';

import {
  PendingTransactionStorage,
  TransactionPoolService as ITransactionPoolService,
} from '../../types/transactionPool';
import { RedisPendingTransactionStorage } from './RedisPendingTransactionStorage';

/**
 * Service implementation that orchestrates pending transaction management.
 * Acts as a facade for the underlying storage layer and coordinates transaction lifecycle.
 */
export class TransactionPoolService implements ITransactionPoolService {
  /**
   * Gauge tracking number of unique addresses with pending transactions.
   */
  private readonly activeAddressesGauge: Gauge;

  /**
   * The logger used for logging transaction pool operations.
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * Counter tracking pool operations (add, remove).
   */
  private readonly operationsCounter: Counter;

  /**
   * Gauge tracking current total pending transactions across all addresses.
   */
  private readonly pendingCountGauge: Gauge;

  /**
   * Counter tracking storage operation failures by operation and backend type.
   */
  private readonly storageErrorsCounter: Counter;

  /**
   * The storage implementation for managing pending transactions.
   *
   * @private
   */
  private readonly storage: PendingTransactionStorage;

  /**
   * The type of storage backend used for managing pending transactions.
   * Value can be 'redis' for Redis-backed storage, or 'local' for in-memory storage.
   * Used for metric labeling and operation tracking.
   *
   * @private
   * @readonly
   */
  private readonly storageType: string;

  /**
   * Return if the transaction pool is enabled based on ENABLE_TX_POOL env
   */
  public static isEnabled(): boolean {
    return ConfigService.get('ENABLE_TX_POOL');
  }

  /**
   * Creates a new TransactionPoolService instance.
   *
   * @param storage - The storage backend for pending transactions.
   * @param logger - The logger instance for transaction pool operations.
   * @param register - Prometheus registry for metrics.
   */
  constructor(storage: PendingTransactionStorage, logger: Logger, register: Registry) {
    this.storage = storage;
    this.logger = logger.child({ name: 'transaction-pool-service' });
    this.storageType = storage instanceof RedisPendingTransactionStorage ? 'redis' : 'local';
    const metricNames = [
      'rpc_relay_txpool_pending_count',
      'rpc_relay_txpool_operations_total',
      'rpc_relay_txpool_storage_errors_total',
      'rpc_relay_txpool_active_addresses',
    ];
    metricNames.forEach((name) => register.removeSingleMetric(name));

    this.pendingCountGauge = new Gauge({
      name: 'rpc_relay_txpool_pending_count',
      help: 'Current total pending transactions across all addresses.',
      registers: [register],
      collect: async () => {
        const count = (await this.getAllTransactions()).size;
        this.pendingCountGauge.set(count);
      },
    });

    this.operationsCounter = new Counter({
      name: 'rpc_relay_txpool_operations_total',
      help: 'Pool operations. Operation: add, remove.',
      labelNames: ['operation'],
      registers: [register],
    });

    this.storageErrorsCounter = new Counter({
      name: 'rpc_relay_txpool_storage_errors_total',
      help: 'Storage operation failures. Backend: local, redis. Operation: add, remove, get.',
      labelNames: ['operation', 'backend'],
      registers: [register],
    });

    this.activeAddressesGauge = new Gauge({
      name: 'rpc_relay_txpool_active_addresses',
      help: 'All current unique addresses having transactions in the pending pool',
      registers: [register],
      collect: async () => {
        const count = await this.getUniqueAddressesCount();
        this.activeAddressesGauge.set(count);
      },
    });
  }

  /**
   * Saves a transaction into the transaction pool for the given address.
   *
   * @param address - The account address that submits the transaction.
   * @param tx - The transaction object to be stored.
   * @returns A promise that resolves once the transaction is stored.
   */
  async saveTransaction(address: string, tx: Transaction): Promise<void> {
    if (!TransactionPoolService.isEnabled()) {
      return;
    }

    const addressLowerCased = address.toLowerCase();
    const rlpHex = tx.serialized;

    try {
      await this.storage.addToList(addressLowerCased, rlpHex);
      this.operationsCounter.labels('add').inc();
      this.logger.debug({ address, rlpHex: rlpHex.substring(0, 20) + '...' }, 'Transaction saved to pool');
    } catch (error) {
      this.logger.error(
        { address, error: (error as Error).message, rlpHex: rlpHex.substring(0, 20) + '...' },
        'Failed to save transaction to pool',
      );
      this.storageErrorsCounter.labels('add', this.storageType).inc();
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
    if (!TransactionPoolService.isEnabled()) {
      return;
    }

    const addressLowerCased = address.toLowerCase();

    try {
      await this.storage.removeFromList(addressLowerCased, rlpHex);
      this.pendingCountGauge.dec();
      this.operationsCounter.labels('remove').inc();
      this.logger.debug({ address, rlpHex: rlpHex.substring(0, 20) + '...' }, 'Transaction removed from pool');
    } catch (error) {
      this.logger.error(
        { address, error: (error as Error).message, rlpHex: rlpHex.substring(0, 20) + '...' },
        'Failed to remove transaction from pool',
      );
      this.storageErrorsCounter.labels('remove', this.storageType).inc();
      throw error;
    }
  }

  /**
   * Retrieves the number of pending transactions for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to the number of pending transactions.
   *          Returns 0 if the transaction pool is disabled.
   */
  async getPendingCount(address: string): Promise<number> {
    if (!TransactionPoolService.isEnabled()) {
      return 0;
    }

    const addressLowerCased = address.toLowerCase();

    try {
      return await this.storage.getList(addressLowerCased);
    } catch (error) {
      this.logger.error({ address, error: (error as Error).message }, 'Failed to get pending count');
      this.storageErrorsCounter.labels('get', this.storageType).inc();
      throw error;
    }
  }

  /**
   * Retrieves all pending transaction RLP payloads for a given address.
   *
   * @param address - The account address to query.
   * @returns A promise that resolves to a Set of RLP hex strings.
   *          Returns an empty set if the transaction pool is disabled.
   */
  async getTransactions(address: string): Promise<Set<string>> {
    if (!TransactionPoolService.isEnabled()) {
      return new Set();
    }

    const addressLowerCased = address.toLowerCase();

    try {
      const payloads = await this.storage.getTransactionPayloads(addressLowerCased);
      this.logger.debug({ address, totalPayloads: payloads.size }, 'Retrieved transactions for address');
      return payloads;
    } catch (error) {
      this.logger.error({ address, error: (error as Error).message }, 'Failed to get transactions for address');
      this.storageErrorsCounter.labels('get', this.storageType).inc();
      throw error;
    }
  }

  /**
   * Retrieves all pending transaction RLP payloads across all addresses.
   *
   * @returns A promise that resolves to a Set of RLP hex strings.
   *          Returns an empty set if the transaction pool is disabled.
   */
  async getAllTransactions(): Promise<Set<string>> {
    if (!TransactionPoolService.isEnabled()) {
      return new Set();
    }

    try {
      return await this.storage.getAllTransactionPayloads();
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'Failed to get all transactions');
      this.storageErrorsCounter.labels('get', this.storageType).inc();
      throw error;
    }
  }

  /**
   * Retrieves the number of unique addresses with pending transactions.
   *
   * @returns A promise that resolves to the count of unique addresses.
   */
  async getUniqueAddressesCount(): Promise<number> {
    try {
      return await this.storage.getUniqueAddressCount();
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'Failed to get unique addresses count');
      this.storageErrorsCounter.labels('get', this.storageType).inc();
      throw error;
    }
  }
}
