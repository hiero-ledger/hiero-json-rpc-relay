// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';

import { ConfigService } from '../../../../config-service/services';
import { type JsonRpcError, predefined } from '../../errors/JsonRpcError';
import {
  type ITransactionTracingService,
  type ITransactionTracingStorage,
  type TransactionTraceRecord,
} from '../../types/transactionTracing';

/**
 * Facade coordinating the transaction tracing subsystem: records each submitted transaction's lifecycle,
 * keyed by its keccak256 hash, into the injected {@link ITransactionTracingStorage}.
 *
 * Storage is injected (built by the composition root only when `TX_STATUS_TRACING` is on), so with tracing
 * disabled the storage is undefined and every method is a no-op - no hot-path change. Recording failures
 * are swallowed (logged at error) - tracing must never break the submission or receipt paths.
 */
export class TransactionTracingService implements ITransactionTracingService {
  private readonly logger: Logger;

  /** Backing storage; undefined (every operation a no-op) when tracing is disabled. */
  private readonly storage?: ITransactionTracingStorage;

  /**
   * Whether tracing is enabled via `TX_STATUS_TRACING`.
   *
   * @returns True when the `TX_STATUS_TRACING` flag is on.
   */
  public static isEnabled(): boolean {
    return ConfigService.get('TX_STATUS_TRACING');
  }

  /**
   * @param logger - Logger instance for the service.
   * @param storage - Backing storage, or undefined to disable tracing (built by the composition root).
   */
  constructor(logger: Logger, storage?: ITransactionTracingStorage) {
    this.logger = logger.child({ name: 'transaction-tracing-service' });
    this.storage = storage;
  }

  /**
   * Normalizes a hash to the canonical storage key form (lower-cased).
   *
   * @param hash - The transaction's keccak256 hash.
   * @returns The lower-cased hash.
   */
  private normalizeHash(hash: string): string {
    return hash.toLowerCase();
  }

  /**
   * Persists a record, swallowing (and logging) any storage error.
   *
   * @param hash - The transaction's keccak256 hash.
   * @param record - The lifecycle record to persist.
   */
  private async safeSet(hash: string, record: TransactionTraceRecord): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.set(this.normalizeHash(hash), record);
    } catch (error) {
      this.logger.error(error, 'Failed to record %s trace for transaction %s', record.status, hash);
    }
  }

  /**
   * Records the `pending` state - in the local pool, not yet submitted.
   *
   * @param hash - The transaction's keccak256 hash.
   */
  async recordPending(hash: string): Promise<void> {
    await this.safeSet(hash, { status: 'pending', timestamp: Date.now() });
  }

  /**
   * Records the `sent` state - submitted with no error.
   *
   * @param hash - The transaction's keccak256 hash.
   * @param transactionId - The Hedera transaction id assigned on submission.
   */
  async recordSent(hash: string, transactionId?: string): Promise<void> {
    await this.safeSet(hash, { status: 'sent', timestamp: Date.now(), transactionId });
  }

  /**
   * Records the `rejected` state for a pre-execution or ingress failure.
   *
   * @param hash - The transaction's keccak256 hash.
   * @param details - Failure detail, Hedera status code, and transaction id (all optional).
   */
  async recordRejected(
    hash: string,
    details: { error?: string; hederaStatus?: string; transactionId?: string } = {},
  ): Promise<void> {
    await this.safeSet(hash, { status: 'rejected', timestamp: Date.now(), ...details });
  }

  /**
   * Records the `timedout` state - timed out / connection dropped before an outcome was known.
   * Provisional: the transaction may still reach consensus within the validity window.
   *
   * @param hash - The transaction's keccak256 hash.
   * @param details - Failure detail, Hedera status code, and transaction id (all optional).
   */
  async recordTimedout(
    hash: string,
    details: { error?: string; hederaStatus?: string; transactionId?: string } = {},
  ): Promise<void> {
    await this.safeSet(hash, { status: 'timedout', timestamp: Date.now(), ...details });
  }

  /**
   * Records the `validated` state on a Mirror Node receipt. Only upgrades an existing record (preserving
   * its transaction id) - never creates one for a hash the relay didn't submit, so lookups don't pollute
   * the store.
   *
   * @param hash - The transaction's keccak256 hash.
   */
  async recordValidated(hash: string): Promise<void> {
    if (!this.storage) return;
    try {
      const key = this.normalizeHash(hash);
      const existing = await this.storage.get(key);
      if (!existing || existing.status === 'validated') return;
      await this.storage.set(key, { ...existing, status: 'validated', timestamp: Date.now() });
    } catch (error) {
      this.logger.error(error, 'Failed to record validated trace for transaction %s', hash);
    }
  }

  /**
   * Returns the raw trace record for a hash, or null. Used by admin inspection.
   *
   * @param hash - The transaction's keccak256 hash.
   * @returns The trace record, or null if none exists (tracing off, or the read failed).
   */
  async getByHash(hash: string): Promise<TransactionTraceRecord | null> {
    if (!this.storage) return null;
    try {
      return await this.storage.get(this.normalizeHash(hash));
    } catch (error) {
      this.logger.error(error, 'Failed to read trace for transaction %s', hash);
      return null;
    }
  }

  /**
   * Consulted on the `eth_getTransactionReceipt` Mirror-Node-not-found path.
   *
   * Returns a `-32003` {@link JsonRpcError} carrying the failure detail and offending `txHash` when the
   * traced state is `rejected` or `timedout`; returns null otherwise (including when tracing is off or no
   * record exists), preserving the default `null` receipt response.
   *
   * @param hash - The transaction's keccak256 hash.
   * @returns A `-32003` error for a `rejected`/`timedout` record, or null.
   */
  async getReceiptFallbackError(hash: string): Promise<JsonRpcError | null> {
    if (!this.storage) return null;

    const txHash = this.normalizeHash(hash);
    let record: TransactionTraceRecord | null;
    try {
      record = await this.storage.get(txHash);
    } catch (error) {
      this.logger.error(error, 'Failed to read trace for transaction %s during receipt fallback', hash);
      return null;
    }

    if (!record) return null;

    if (record.status === 'rejected') {
      return predefined.TRANSACTION_REJECTED_DETAILED({
        txHash,
        detail: record.error,
        hederaStatus: record.hederaStatus,
        transactionId: record.transactionId,
      });
    }

    if (record.status === 'timedout') {
      return predefined.TRANSACTION_REJECTED_DETAILED({
        txHash,
        message:
          'Transaction submission timed out and has not yet reached consensus; it may still be confirmed within the network validity window',
        detail: record.error ?? 'The transaction timed out during submission and may still reach consensus.',
        hederaStatus: record.hederaStatus,
        provisional: true,
        transactionId: record.transactionId,
      });
    }

    return null;
  }
}
