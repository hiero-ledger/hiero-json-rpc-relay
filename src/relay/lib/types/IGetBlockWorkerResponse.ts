// SPDX-License-Identifier: Apache-2.0

import { type Block } from '../model';
import { type TransactionTimestampEntry } from './ITransactionTimestampIndex';

/**
 * Result of the `getBlock` worker task.
 *
 * @property block - The assembled block.
 * @property syntheticTimestampEntries - Consensus timestamps of the block's synthetic transactions, returned
 *   as plain data so they survive the worker boundary.
 */
export interface IGetBlockWorkerResponse {
  block: Block;
  syntheticTimestampEntries: ReadonlyArray<TransactionTimestampEntry>;
}
