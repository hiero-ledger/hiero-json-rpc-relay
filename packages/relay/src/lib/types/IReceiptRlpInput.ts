// SPDX-License-Identifier: Apache-2.0

import { Log } from '../model';

/**
 * Input shape used when building RLP-encoded transaction receipt data.
 *
 * @property cumulativeGasUsed - Cumulative gas used up to and including this transaction (hex).
 * @property logs - Log entries emitted by this transaction.
 * @property logsBloom - Bloom filter for logs (hex).
 * @property root - Post-state root (legacy pre-byzantium); use empty string when using status.
 * @property status - Transaction status: `"0x1"` success, `"0x0"` reverted (hex).
 * @property transactionIndex - Index of the transaction in the block (hex), or null.
 * @property type - Transaction type (e.g. `"0x0"`, `"0x2"`) or null for legacy.
 */
export interface IReceiptRlpInput {
  cumulativeGasUsed: string;
  logs: Log[];
  logsBloom: string;
  root: string;
  status: string;
  transactionIndex: string | null;
  type: string | null;
}
