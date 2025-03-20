// SPDX-License-Identifier: Apache-2.0
import { numberTo0x, toHash32 } from '../../../formatters';
import { IReceiptRootHash, ReceiptsRootUtils } from '../../../receiptsRootUtils';
import constants from '../../constants';
import { Block } from '../../model';

interface BlockFactoryParams {
  blockResponse: any; // Define a more specific type based on your actual response
  contractResults: any[]; // Define a more specific type
  logs: any[]; // Define a more specific type
  showDetails: boolean;
  gasUsed: number;
  transactionArray: any[];
  timestamp: string;
}

export class BlockFactory {
  static async createBlock(params: BlockFactoryParams): Promise<Block | null> {
    const { blockResponse, contractResults, logs, showDetails, gasUsed, transactionArray, timestamp } = params;

    const formattedReceipts: IReceiptRootHash[] = ReceiptsRootUtils.buildReceiptRootHashes(
      transactionArray.map((tx) => (showDetails ? tx.hash : tx)),
      contractResults,
      logs,
    );

    const blockHash = toHash32(blockResponse.hash);
    const emptyBloom =
      '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    // create a BlockFactory
    // resolve how to get baseFeePerGas
    return new Block({
      baseFeePerGas: '0x0', //await this.gasPrice(requestDetails),
      difficulty: '0x0',
      extraData: '0x',
      gasLimit: numberTo0x(constants.BLOCK_GAS_LIMIT),
      gasUsed: numberTo0x(gasUsed),
      hash: blockHash,
      logsBloom: blockResponse.logs_bloom === '0x' ? emptyBloom : blockResponse.logs_bloom,
      miner: '0x0000000000000000000000000000000000000000',
      mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      nonce: '0x0000000000000000',
      number: numberTo0x(blockResponse.number),
      parentHash: blockResponse.previous_hash.substring(0, 66),
      receiptsRoot: await ReceiptsRootUtils.getRootHash(formattedReceipts),
      timestamp: numberTo0x(Number(timestamp)),
      sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
      size: numberTo0x(blockResponse.size | 0),
      stateRoot: constants.DEFAULT_ROOT_HASH,
      totalDifficulty: '0x0',
      transactions: transactionArray,
      transactionsRoot: transactionArray.length == 0 ? constants.DEFAULT_ROOT_HASH : blockHash,
      uncles: [],
    });
  }
}
