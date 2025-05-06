// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { Trie } from '@ethereumjs/trie';
import { bytesToInt, concatBytes, hexToBytes, intToBytes, intToHex } from '@ethereumjs/util';

import { prepend0x } from './formatters';
import constants from './lib/constants';
import { Log } from './lib/model';
import { LogsBloomUtils } from './logsBloomUtils';
/**
 * A {Log} serialized as a tuple containing:
 * - {Uint8Array} address
 * - {Uint8Array[]} topics
 * - {Uint8Array} data
 */
export type SerializedLog = [Uint8Array, Uint8Array[], Uint8Array];

export interface IReceiptRootHashLog {
  address: string;
  data: string;
  topics: string[];
}

export interface IReceiptRootHash {
  cumulativeGasUsed: string;
  logs: IReceiptRootHashLog[];
  logsBloom: string;
  root: string;
  status: string;
  transactionIndex: string;
  type: string | null; // null for HAPI transactions
}

export class ReceiptsRootUtils {
  private static encodeLogs(logs: IReceiptRootHashLog[]): SerializedLog[] {
    const serializedLogs: SerializedLog[] = [];
    for (const log of logs) {
      const topics: Uint8Array[] = [];
      for (const topic of log.topics) {
        topics.push(hexToBytes(topic));
      }
      serializedLogs.push([hexToBytes(log.address), topics, hexToBytes(log.data)]);
    }

    return serializedLogs;
  }

  private static encodeReceipt(receipt: IReceiptRootHash, txType: number): Uint8Array {
    let receiptRoot: Uint8Array;
    if (receipt.root) {
      receiptRoot = hexToBytes(receipt.root);
    } else if (bytesToInt(hexToBytes(receipt.status)) === 0) {
      receiptRoot = Uint8Array.from([]);
    } else {
      receiptRoot = hexToBytes(constants.ONE_HEX);
    }

    const encodedReceipt: Uint8Array = RLP.encode([
      receiptRoot,
      hexToBytes(receipt.cumulativeGasUsed),
      hexToBytes(receipt.logsBloom),
      this.encodeLogs(receipt.logs),
    ]);

    // legacy transactions
    if (txType === 0) {
      return encodedReceipt;
    }

    // EIP-2718 serialization
    return concatBytes(intToBytes(txType), encodedReceipt);
  }

  public static buildReceiptRootHashes(txHashes: string[], contractResults: any[], logs: Log[]): IReceiptRootHash[] {
    const receipts: IReceiptRootHash[] = [];

    for (const i in txHashes) {
      const txHash: string = txHashes[i];
      const logsPerTx: Log[] = logs.filter((log) => log.transactionHash == txHash);
      const crPerTx: any[] = contractResults.filter((cr) => cr.hash == txHash);

      // Determine the transaction index for the current transaction hash:
      // - Prefer the `transaction_index` from the contract results (`crPerTx`) if available.
      // - Fallback to the `transactionIndex` from logs (`logsPerTx`) if no valid `transaction_index` is found in `crPerTx`.
      // - If neither source provides a valid value, `transactionIndex` remains `null`.
      let transactionIndex: any = null;
      if (crPerTx.length && crPerTx[0].transaction_index != null) {
        transactionIndex = intToHex(crPerTx[0].transaction_index);
      } else if (logsPerTx.length) {
        transactionIndex = logsPerTx[0].transactionIndex;
      }

      receipts.push({
        transactionIndex,
        type: crPerTx.length && crPerTx[0].type ? intToHex(crPerTx[0].type) : null,
        root: crPerTx.length ? crPerTx[0].root : constants.ZERO_HEX_32_BYTE,
        status: crPerTx.length ? crPerTx[0].status : constants.ONE_HEX,
        cumulativeGasUsed:
          crPerTx.length && crPerTx[0].block_gas_used ? intToHex(crPerTx[0].block_gas_used) : constants.ZERO_HEX,
        logsBloom: crPerTx.length
          ? crPerTx[0].bloom
          : LogsBloomUtils.buildLogsBloom(logs[0].address, logsPerTx[0].topics),
        logs: logsPerTx.map((log: IReceiptRootHashLog) => {
          return {
            address: log.address,
            data: log.data,
            topics: log.topics,
          };
        }),
      });
    }

    return receipts;
  }

  public static async getRootHash(receipts: IReceiptRootHash[]): Promise<string> {
    if (!receipts.length) {
      return constants.ZERO_HEX_32_BYTE;
    }

    const trie: Trie = new Trie();
    receipts.map(async (receipt) => {
      // key of the element that is being added to the trie
      const path: Uint8Array =
        receipt.transactionIndex === constants.ZERO_HEX
          ? RLP.encode(Buffer.alloc(0))
          : RLP.encode(bytesToInt(hexToBytes(receipt.transactionIndex ?? constants.ZERO_HEX)));
      await trie.put(path, this.encodeReceipt(receipt, bytesToInt(hexToBytes(receipt.type ?? constants.ZERO_HEX))));
    });

    trie.checkpoint();
    await trie.commit();

    return prepend0x(Buffer.from(trie.root()).toString('hex'));
  }
}
