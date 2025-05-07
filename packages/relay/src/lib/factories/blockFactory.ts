// SPDX-License-Identifier: Apache-2.0

import { numberTo0x, toHash32 } from '../../formatters';
import { IReceiptRootHash, ReceiptsRootUtils } from '../../receiptsRootUtils';
import constants from '../constants';
import { Block } from '../model';
import { MirrorNodeBlock } from '../types/mirrorNode';

interface BlockFactoryParams {
  blockResponse: MirrorNodeBlock;
  receipts: IReceiptRootHash[];
  txArray: any[];
  gasPrice: string;
}

export class BlockFactory {
  static async createBlock(params: BlockFactoryParams): Promise<Block> {
    const { blockResponse, receipts, txArray, gasPrice } = params;

    const blockHash = toHash32(blockResponse.hash);
    const timestampRange = blockResponse.timestamp;
    const timestamp = timestampRange.from.substring(0, timestampRange.from.indexOf('.'));

    return new Block({
      baseFeePerGas: gasPrice,
      difficulty: constants.ZERO_HEX,
      extraData: constants.EMPTY_HEX,
      gasLimit: numberTo0x(constants.BLOCK_GAS_LIMIT),
      gasUsed: numberTo0x(blockResponse.gas_used),
      hash: blockHash,
      logsBloom: blockResponse.logs_bloom === constants.EMPTY_HEX ? constants.EMPTY_BLOOM : blockResponse.logs_bloom,
      miner: constants.ZERO_ADDRESS_HEX,
      mixHash: constants.ZERO_HEX_32_BYTE,
      nonce: constants.ZERO_HEX_8_BYTE,
      number: numberTo0x(blockResponse.number),
      parentHash: blockResponse.previous_hash.substring(0, 66),
      receiptsRoot: await ReceiptsRootUtils.getRootHash(receipts),
      timestamp: numberTo0x(Number(timestamp)),
      sha3Uncles: constants.EMPTY_ARRAY_HEX,
      size: numberTo0x(blockResponse.size | 0),
      stateRoot: constants.DEFAULT_ROOT_HASH,
      totalDifficulty: constants.ZERO_HEX,
      transactions: txArray,
      transactionsRoot: txArray.length == 0 ? constants.DEFAULT_ROOT_HASH : blockHash,
      uncles: [],
    });
  }
}
