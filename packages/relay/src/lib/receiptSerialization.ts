// SPDX-License-Identifier: Apache-2.0

/**
 * Receipt serialization per Ethereum Yellow Paper and EIP-2718.
 *
 * Yellow Paper: receipt is RLP of the 4-tuple
 *   (receipt_root_or_status, cumulative_gas_used, logs_bloom, logs).
 * Post-Byzantium: first field is status (empty for 0, 0x01 for 1) or 32-byte state root.
 * Each log: RLP([address, topics[], data]).
 *
 * EIP-2718: for typed txs (type !== 0), wire format is type_byte || RLP(above 4-tuple).
 */

import { RLP } from '@ethereumjs/rlp';
import { bytesToInt, concatBytes, hexToBytes, intToBytes } from '@ethereumjs/util';

import { prepend0x } from '../formatters';
import constants from './constants';
import type { ITransactionReceipt } from './types';

// Log shape used for encoding: address, topics[], data (per Yellow Paper log structure)
function encodeLogsForReceipt(logs: ITransactionReceipt['logs']): [Uint8Array, Uint8Array[], Uint8Array][] {
  return logs.map((log) => [hexToBytes(log.address), log.topics.map((t) => hexToBytes(t)), hexToBytes(log.data)]);
}

/**
 * Encodes a single receipt to EIP-2718 binary form (hex string).
 * Matches the structure used in blockWorker for receipt trie (Yellow Paper + EIP-2718).
 */
export function encodeReceiptToHex(receipt: ITransactionReceipt): string {
  const txType = receipt.type != null ? bytesToInt(hexToBytes(receipt.type)) : 0;

  // First field: receipt root or status (post-Byzantium)
  let receiptRootOrStatus: Uint8Array;
  if (receipt.root && receipt.root.length >= 2) {
    receiptRootOrStatus = hexToBytes(receipt.root);
  } else if (receipt.status && bytesToInt(hexToBytes(receipt.status)) === 0) {
    receiptRootOrStatus = new Uint8Array(0);
  } else {
    receiptRootOrStatus = hexToBytes(constants.ONE_HEX);
  }

  const encodedList = RLP.encode([
    receiptRootOrStatus,
    hexToBytes(receipt.cumulativeGasUsed),
    hexToBytes(receipt.logsBloom),
    encodeLogsForReceipt(receipt.logs),
  ]);

  if (txType === 0) {
    return prepend0x(Buffer.from(encodedList).toString('hex'));
  }
  const withPrefix = concatBytes(intToBytes(txType), encodedList);
  return prepend0x(Buffer.from(withPrefix).toString('hex'));
}
