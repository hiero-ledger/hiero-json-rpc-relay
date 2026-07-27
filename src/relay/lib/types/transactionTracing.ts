// SPDX-License-Identifier: Apache-2.0

import { type JsonRpcError } from '../errors/JsonRpcError';

/**
 * Lifecycle state of a submitted transaction.
 *
 * - `pending`   - in the local pool, not yet submitted to the consensus node.
 * - `sent`      - submitted without a submission error; a transaction id exists.
 * - `validated` - the Mirror Node has reflected a receipt.
 * - `rejected`  - a pre-execution failure (e.g. WRONG_NONCE) or an ingress error.
 * - `timedout`  - timed out / connection dropped before an outcome was known; may still reach consensus.
 */
export type TransactionTracingStatus = 'pending' | 'sent' | 'validated' | 'rejected' | 'timedout';

/**
 * A traced transaction lifecycle record. Keyed by keccak256 hash, so the raw RLP payload is not stored.
 */
export interface TransactionTraceRecord {
  /** Current lifecycle state. */
  status: TransactionTracingStatus;

  /** Epoch milliseconds when this record was last written. */
  timestamp: number;

  /** Hedera transaction id, available once submitted (`sent` and later). */
  transactionId?: string;

  /** For `rejected` / `timedout`, a human-readable failure detail. */
  error?: string;

  /** For failure states, the underlying Hedera status code (e.g. `WRONG_NONCE`), when known. */
  hederaStatus?: string;
}

/**
 * Storage layer for transaction tracing records, keyed by keccak256 hash. TTL-aware; the TTL is supplied
 * to the implementation at construction time.
 */
export interface ITransactionTracingStorage {
  /**
   * Stores (or overwrites) the record for the given hash. A resend shares the hash and overwrites the
   * existing record (last-write-wins).
   *
   * @param hash - The transaction's keccak256 hash (lower-cased 0x-prefixed hex).
   * @param record - The lifecycle record to persist.
   */
  set(hash: string, record: TransactionTraceRecord): Promise<void>;

  /**
   * Retrieves the record for the given hash, or null if none exists.
   *
   * @param hash - The transaction's keccak256 hash (lower-cased 0x-prefixed hex).
   * @returns The record, or null if none exists.
   */
  get(hash: string): Promise<TransactionTraceRecord | null>;

  /**
   * Removes the record for the given hash.
   *
   * @param hash - The transaction's keccak256 hash (lower-cased 0x-prefixed hex).
   */
  delete(hash: string): Promise<void>;
}

/**
 * Records each submitted transaction's lifecycle and serves the receipt fallback + admin inspection.
 * Every method is a no-op when tracing is disabled (no backing storage).
 */
export interface ITransactionTracingService {
  /**
   * Records the `pending` state - in the local pool, not yet submitted.
   *
   * @param hash - The transaction's keccak256 hash.
   */
  recordPending(hash: string): Promise<void>;

  /**
   * Records the `sent` state - submitted with no error.
   *
   * @param hash - The transaction's keccak256 hash.
   * @param transactionId - The Hedera transaction id assigned on submission.
   */
  recordSent(hash: string, transactionId?: string): Promise<void>;

  /**
   * Records the `rejected` state for a pre-execution or ingress failure.
   *
   * @param hash - The transaction's keccak256 hash.
   * @param details - Failure detail, Hedera status code, and transaction id (all optional).
   */
  recordRejected(
    hash: string,
    details?: { error?: string; hederaStatus?: string; transactionId?: string },
  ): Promise<void>;

  /**
   * Records the `timedout` state - outcome unknown; the tx may still reach consensus.
   *
   * @param hash - The transaction's keccak256 hash.
   * @param details - Failure detail, Hedera status code, and transaction id (all optional).
   */
  recordTimedout(
    hash: string,
    details?: { error?: string; hederaStatus?: string; transactionId?: string },
  ): Promise<void>;

  /**
   * Records the `validated` state on a Mirror Node receipt (upgrade-only; never creates a record).
   *
   * @param hash - The transaction's keccak256 hash.
   */
  recordValidated(hash: string): Promise<void>;

  /**
   * Returns the raw trace record for a hash, or null.
   *
   * @param hash - The transaction's keccak256 hash.
   * @returns The trace record, or null if none exists.
   */
  getByHash(hash: string): Promise<TransactionTraceRecord | null>;

  /**
   * Returns a `-32003` error for a `rejected`/`timedout` record, or null otherwise. Consulted on the
   * `eth_getTransactionReceipt` Mirror-Node-not-found path.
   *
   * @param hash - The transaction's keccak256 hash.
   * @returns A `-32003` error for a `rejected`/`timedout` record, or null.
   */
  getReceiptFallbackError(hash: string): Promise<JsonRpcError | null>;
}
