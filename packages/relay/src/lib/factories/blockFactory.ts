// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { ethers } from 'ethers';

import { numberTo0x, toHash32 } from '../../formatters';
import constants from '../constants';
import { Block, Transaction, Transaction1559, Transaction2930 } from '../model';
import { MirrorNodeBlock } from '../types/mirrorNode';

interface BlockFactoryParams {
  blockResponse: MirrorNodeBlock;
  txArray: any[];
  gasPrice: string;
  receiptsRoot: string;
}

export class BlockFactory {
  static async createBlock(params: BlockFactoryParams): Promise<Block> {
    const { blockResponse, txArray, gasPrice, receiptsRoot } = params;

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
      receiptsRoot,
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

  /**
   * Reconstructs the RLP-encoded raw transaction from a Transaction model object.
   * Uses ethers.Transaction which handles the EIP-2718 typed transaction envelope automatically.
   *
   * @param {Transaction} tx - The transaction model object from eth_getTransactionByHash.
   * @returns {string} The RLP-encoded raw transaction as a hex string.
   */
  // TODO: remove this method because it should be part of `debug_getRawTransaction` PR and here we should use it on-the-fly
  static rlpEncodeTx(tx: Transaction): string {
    const ethersTx = new ethers.Transaction();

    const txType = parseInt(tx.type, 16);
    ethersTx.type = txType;
    ethersTx.to = tx.to;
    ethersTx.nonce = parseInt(tx.nonce, 16);
    ethersTx.gasLimit = BigInt(tx.gas);
    ethersTx.data = tx.input;
    ethersTx.value = BigInt(tx.value);
    ethersTx.chainId = tx.chainId ? BigInt(tx.chainId) : BigInt(0);

    if (txType === 2) {
      const tx1559 = tx as Transaction1559;
      ethersTx.maxFeePerGas = BigInt(tx1559.maxFeePerGas);
      ethersTx.maxPriorityFeePerGas = BigInt(tx1559.maxPriorityFeePerGas);
    } else {
      ethersTx.gasPrice = BigInt(tx.gasPrice);
    }

    if (txType === 1 || txType === 2) {
      const tx2930 = tx as Transaction2930;
      ethersTx.accessList = tx2930.accessList ?? [];
    }

    // Set signature - pad empty/zero values for synthetic transactions
    const r = tx.r === '0x' || tx.r === '0x0' ? constants.ZERO_HEX_32_BYTE : tx.r;
    const s = tx.s === '0x' || tx.s === '0x0' ? constants.ZERO_HEX_32_BYTE : tx.s;
    const v = parseInt(tx.v ?? '0x0', 16);
    ethersTx.signature = ethers.Signature.from({ r, s, v });

    return ethersTx.serialized;
  }

  /**
   * RLP encode a block based on Ethereum Yellow Paper.
   *
   * @param { Block } block - The block object from eth_getBlockByNumber/Hash
   */
  static rlpEncode(block: Block): Uint8Array {
    // -- BH - block header
    // Hp - parentHash
    // Ho - ommersHash
    // Hc - beneficiary
    // Hr - stateRoot
    // Ht - transactionsRoot
    // He - receiptsRoot
    // Hb - logsBloom
    // Hd - difficulty
    // Hi - number
    // Hl - gasLimit
    // Hg - gasUsed
    // Hs - timestamp
    // Hx - extraData
    // Ha - prevRandao
    // Hn - nonce
    // Hf - baseFeePerGas
    // Hw - withdrawalsRoot
    // -- BT - block transactions (RLP encoded transactions array)
    // -- BU - ommers (empty array)
    // -- BW - withdrawals (empty list)

    // Regarding the yellow paper - B=(BH,BT,BU,BW)
    return RLP.encode([
      block.parentHash,
      constants.EMPTY_ARRAY_HEX, // keccak256(rlp(()))
      '0x0000000000000000000000000000000000000321', // 0.0.801
      block.stateRoot,
      block.transactionsRoot,
      block.receiptsRoot,
      block.logsBloom,
      block.difficulty,
      block.number,
      block.gasLimit,
      block.gasUsed,
      block.timestamp,
      block.extraData,
      block.totalDifficulty,
      block.nonce,
      block.baseFeePerGas,
      block.withdrawalsRoot,
      [...block.transactions.map((tx) => BlockFactory.rlpEncodeTx(tx as Transaction))],
      [],
      constants.EMPTY_ARRAY_HEX, // keccak256(rlp(()))
    ]);
  }
}
