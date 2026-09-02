// SPDX-License-Identifier: Apache-2.0

/** A transaction hash paired with the Hedera consensus timestamp of the transaction it belongs to. */
export type TransactionTimestampEntry = readonly [hash: string, consensusTimestamp: string];

/**
 * A lookup from an ethereum transaction hash to the Hedera consensus timestamp of the transaction it belongs
 * to, used to resolve a transaction the Mirror Node has imported but cannot yet answer for by hash.
 *
 * Only synthetic transactions belong here: the read side builds a synthetic receipt from whatever it finds,
 * so recording a normal transaction would produce a wrongly shaped receipt.
 *
 * Timestamps are kept verbatim in the Mirror Node's `seconds.nanoseconds` form; the nanoseconds identify a
 * single transaction and do not survive conversion to a number.
 */
export interface ITransactionTimestampIndex {
  /**
   * Records the hash to consensus timestamp mapping for a batch of transactions, overwriting any existing
   * entry for the same hash.
   *
   * @param entries - `[hash, consensusTimestamp]` pairs.
   */
  setMany(entries: ReadonlyArray<TransactionTimestampEntry>): Promise<void>;

  /**
   * @param hash - The transaction's 0x-prefixed hash.
   * @returns The consensus timestamp recorded for the hash, or null when nothing is recorded.
   */
  get(hash: string): Promise<string | null>;
}
