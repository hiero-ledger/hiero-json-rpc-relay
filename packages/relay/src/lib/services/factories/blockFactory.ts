// SPDX-License-Identifier: Apache-2.0

import { numberTo0x, toHash32 } from '../../../formatters';
import { IReceiptRootHash, ReceiptsRootUtils } from '../../../receiptsRootUtils';
import constants from '../../constants';
import { EthImpl } from '../../eth';
import { Block } from '../../model';
import { IMirrorNodeBlock } from '../../types/IMirrorNodeBlock';
import { CommonService } from '..';

interface BlockFactoryParams {
  blockResponse: IMirrorNodeBlock;
  receipts: IReceiptRootHash[];
  txArray: any[];
  gasPrice: string;
}

export class BlockFactory {
  private static readonly EMPTY_BLOOM = '0x' + '0'.repeat(512);
  private static readonly ZERO_ADDRESS_HEX = '0x' + '0'.repeat(40);

  static async createBlock(params: BlockFactoryParams): Promise<Block> {
    const { blockResponse, receipts, txArray, gasPrice } = params;

    const blockHash = toHash32(blockResponse.hash);
    const timestampRange = blockResponse.timestamp;
    const timestamp = timestampRange.from.substring(0, timestampRange.from.indexOf('.'));

    return new Block({
      baseFeePerGas: gasPrice,
      difficulty: EthImpl.zeroHex,
      extraData: CommonService.emptyHex,
      gasLimit: numberTo0x(constants.BLOCK_GAS_LIMIT),
      gasUsed: numberTo0x(blockResponse.gas_used),
      hash: blockHash,
      logsBloom:
        blockResponse.logs_bloom === CommonService.emptyHex ? BlockFactory.EMPTY_BLOOM : blockResponse.logs_bloom,
      miner: BlockFactory.ZERO_ADDRESS_HEX,
      mixHash: CommonService.zeroHex32Byte,
      nonce: EthImpl.zeroHex8Byte,
      number: numberTo0x(blockResponse.number),
      parentHash: blockResponse.previous_hash.substring(0, 66),
      receiptsRoot: await ReceiptsRootUtils.getRootHash(receipts),
      timestamp: numberTo0x(Number(timestamp)),
      sha3Uncles: EthImpl.emptyArrayHex,
      size: numberTo0x(blockResponse.size | 0),
      stateRoot: constants.DEFAULT_ROOT_HASH,
      totalDifficulty: EthImpl.zeroHex,
      transactions: txArray,
      transactionsRoot: txArray.length == 0 ? constants.DEFAULT_ROOT_HASH : blockHash,
      uncles: [],
    });
  }
}
