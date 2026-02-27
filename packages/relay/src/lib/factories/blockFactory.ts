// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import type { AuthorizationLike, Signature, Transaction as EthersTransaction } from 'ethers';

/**
 * Cached reference to the ethers Transaction class.
 * Loaded lazily via the `ethers/transaction` official subpath export instead of the
 * full barrel, reducing the first-load RSS cost from ~22 MB to ~17 MB.
 * After @hashgraph/sdk is loaded the marginal cost is ~2 MB (shared secp256k1/noble
 * crypto primitives).
 */
let _EthersTransaction: (typeof import('ethers'))['Transaction'] | null = null;

/**
 * Cached reference to the ethers Signature class.
 * Loaded via `ethers/crypto` which is a transitive dependency of `ethers/transaction`
 * and therefore already in the Node.js module cache when {@link getEthersTransaction}
 * has been called first — meaning this require() costs zero additional RSS.
 */
let _EthersSignature: (typeof import('ethers'))['Signature'] | null = null;

/**
 * Returns the lazily-loaded ethers Transaction class.
 *
 * Uses the `ethers/transaction` official subpath (defined in ethers' package.json
 * `exports` field) instead of `require('ethers')` to avoid loading the ~22 MB
 * full barrel. Node.js resolves subpath exports at runtime regardless of whether
 * the TypeScript compiler understands the `exports` field under `moduleResolution: node`.
 */
function getEthersTransaction(): (typeof import('ethers'))['Transaction'] {
  if (!_EthersTransaction) {
    // Use the `ethers/transaction` subpath export to avoid loading the full ethers
    // barrel. TypeScript resolves the return type via the `typeof import('ethers')`
    // cast; the runtime uses Node.js package `exports` map resolution.
    _EthersTransaction = // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('ethers/transaction') as typeof import('ethers')).Transaction;
  }
  return _EthersTransaction!;
}

/**
 * Returns the lazily-loaded ethers Signature class.
 *
 * `ethers/crypto` is already in the module cache by the time this is called
 * (it is a transitive dependency of `ethers/transaction`), so the require()
 * is effectively free.
 */
function getEthersSignature(): (typeof import('ethers'))['Signature'] {
  if (!_EthersSignature) {
    _EthersSignature = // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('ethers/crypto') as typeof import('ethers')).Signature;
  }
  return _EthersSignature!;
}

import { numberTo0x, prepend0x, strip0x, toHash32 } from '../../formatters';
import constants from '../constants';
import {
  AuthorizationListEntry,
  Block,
  Transaction,
  Transaction1559,
  Transaction2930,
  Transaction7702,
} from '../model';
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
  static rlpEncodeTx(tx: Transaction): string {
    const txType = Number(tx.type);

    // Set signature - pad empty/zero values for synthetic transactions
    const r = tx.r === '0x' || tx.r === '0x0' ? constants.ZERO_HEX_32_BYTE : prepend0x(strip0x(tx.r).padStart(64, '0'));
    const s = tx.s === '0x' || tx.s === '0x0' ? constants.ZERO_HEX_32_BYTE : prepend0x(strip0x(tx.s).padStart(64, '0'));

    const EthersTransactionCtor = getEthersTransaction();
    const SignatureCtor = getEthersSignature();
    const ethersTx = new EthersTransactionCtor();

    // Common fields
    ethersTx.type = txType;
    ethersTx.to = tx.to;
    ethersTx.nonce = Number(tx.nonce);
    ethersTx.gasLimit = BigInt(tx.gas);
    ethersTx.data = tx.input;
    ethersTx.value = BigInt(tx.value);
    ethersTx.chainId = tx.chainId ? BigInt(tx.chainId) : BigInt(0);

    // Type-specific handling
    switch (txType) {
      case 4: {
        // EIP-7702
        const t = tx as Transaction7702;
        ethersTx.maxFeePerGas = BigInt(t.maxFeePerGas);
        ethersTx.maxPriorityFeePerGas = BigInt(t.maxPriorityFeePerGas);
        ethersTx.accessList = t.accessList ?? [];
        ethersTx.authorizationList = t.authorizationList
          ? t.authorizationList.map((entry: AuthorizationListEntry) => {
              return {
                chainId: entry.chainId,
                nonce: entry.nonce,
                address: entry.address,
                signature: SignatureCtor.from({
                  r: entry.r,
                  s: entry.s,
                  yParity: Number(entry.yParity) as 0 | 1,
                }),
              } as AuthorizationLike;
            })
          : [];
        break;
      }
      case 2: {
        // EIP-1559
        const t = tx as Transaction1559;
        ethersTx.maxFeePerGas = BigInt(t.maxFeePerGas);
        ethersTx.maxPriorityFeePerGas = BigInt(t.maxPriorityFeePerGas);
        ethersTx.accessList = (tx as Transaction2930).accessList ?? [];
        break;
      }
      case 1: {
        // EIP-2930
        ethersTx.gasPrice = BigInt(tx.gasPrice);
        ethersTx.accessList = (tx as Transaction2930).accessList ?? [];
        break;
      }
      default: {
        // Legacy (type 0)
        ethersTx.gasPrice = BigInt(tx.gasPrice);
      }
    }

    // Signature
    ethersTx.signature = SignatureCtor.from({
      r,
      s,
      v: Number(tx.v ?? '0x0'),
    });

    return ethersTx.serialized;
  }

  /**
   * RLP encode a block based on Ethereum Yellow Paper.
   *
   * @param { Block } block - The block object from eth_getBlockByNumber/Hash
   * @returns {Uint8Array} - RLP encoded block as Uint8 array
   */
  static rlpEncode(block: Block): Uint8Array {
    if (typeof block.transactions[0] === 'string') {
      throw new Error('Block transactions must include full transaction objects for RLP encoding');
    }

    // B=(BH,BT,BU,BW) regarding the yellow paper https://ethereum.github.io/yellowpaper/paper.pdf, Section 4.4.3 on Serialisation.
    // -- BH - block header (Hp, Ho, Hc, Hr, Ht, He, Hb, Hd, Hi, Hl, Hg, Hs, Hx, Ha, Hn, Hf, Hw)
    // -- BT - block transactions (RLP encoded transactions array)
    // -- BU - ommers (empty array)
    // -- BW - withdrawals (empty array)
    return RLP.encode([
      // Hp - parentHash
      block.parentHash,
      // Ho - ommersHash
      constants.EMPTY_ARRAY_HEX, // keccak256(rlp(()))
      // Hc - beneficiary
      constants.HEDERA_NODE_REWARD_ACCOUNT_ADDRESS, // in Hedera, the rewards are not collected by validators but by a specific account
      // Hr - stateRoot
      block.stateRoot,
      // Ht - transactionsRoot
      block.transactionsRoot,
      // He - receiptsRoot
      block.receiptsRoot,
      // Hb - logsBloom
      block.logsBloom,
      // Hd - difficulty
      block.difficulty,
      // Hi - number
      block.number,
      // Hl - gasLimit
      block.gasLimit,
      // Hg - gasUsed
      block.gasUsed,
      // Hs - timestamp
      block.timestamp,
      // Hx - extraData
      block.extraData,
      // Ha - prevRandao
      block.mixHash,
      // Hn - nonce
      block.nonce,
      // Hf - baseFeePerGas
      block.baseFeePerGas,
      // Hw - withdrawalsRoot
      block.withdrawalsRoot,
      // BT - block transactions (RLP encoded transactions array)
      [...block.transactions.map((tx) => BlockFactory.rlpEncodeTx(tx as Transaction))],
      // BU - ommers (empty array)
      [],
      // BW - withdrawals (empty array)
      [],
    ]);
  }
}
