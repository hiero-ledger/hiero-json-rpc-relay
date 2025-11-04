// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ethers } from 'ethers';
import { Logger } from 'pino';

import { numberTo0x } from '../formatters';
import { predefined, TxPool } from '../index';
import constants from './constants';
import { rpcMethod } from './decorators';
import { TransactionPoolService } from './services';
import { PendingTransactionStorage } from './types/transactionPool';
import { rpcParamValidationRules } from './validators';

export interface TxPoolTransaction {
  blockHash: string;
  blockNumber: null;
  transactionIndex: null;
  from: string;
  gas: string;
  hash: string;
  input: string;
  nonce: string;
  to: string | null; // recipient address (null for contract creation)
  value: string;
  type: string;
  v: string | null;
  r: string | null;
  s: string | null;
  chainId?: string; // handle optional chain id for EIP-155
  gasPrice?: string; // handle optional gas price for legacy transactions
  maxFeePerGas?: string; // handle optional field for EIP-1559
  maxPriorityFeePerGas?: string; // handle optional field for EIP-1559
}

export interface TxPoolTransactionsByNonce {
  [nonce: string]: TxPoolTransaction;
}

export interface TxPoolTransactionsByAddressAndNonce {
  [address: string]: TxPoolTransactionsByNonce;
}

export interface TxPoolContent {
  pending: TxPoolTransactionsByAddressAndNonce;
  queued: TxPoolTransactionsByAddressAndNonce;
}

export interface TxPoolContentFrom {
  pending: TxPoolTransactionsByNonce;
  queued: TxPoolTransactionsByNonce;
}

export interface TxPoolStatus {
  pending: string;
  queued: string;
}

/**
 * Provides methods to query pending transactions and pool status.
 */
export class TxPoolImpl implements TxPool {
  /**
   * TransactionPoolService txPoolService
   * @private
   */
  private readonly txPoolService: TransactionPoolService;

  /**
   * Creates a new instance of TxPoolImpl.
   *
   * @param storage - Underlying storage for pending transactions.
   * @param logger - Logger instance for output.
   */
  constructor(storage: PendingTransactionStorage, logger: Logger) {
    this.txPoolService = new TransactionPoolService(storage, logger);
  }

  /**
   * Checks if the Tx Pool API is enabled
   * @public
   */
  static requireTxPoolAPIEnabled(): void {
    if (!ConfigService.get('TXPOOL_API_ENABLED') || !ConfigService.get('ENABLE_TX_POOL')) {
      throw predefined.UNSUPPORTED_METHOD;
    }
  }

  /**
   * Converts a set of RLP-encoded transactions into structured TxPoolTransaction objects.
   *
   * @param rlpTxs - Map of transaction hash - RLP-encoded transaction string.
   * @returns Array of decoded and formatted transactions.
   */
  private convertRlpEncodedTxToTransactionPoolTx(rlpTxs: string[]): TxPoolTransaction[] {
    const txs: TxPoolTransaction[] = [];

    rlpTxs.forEach((rlpTx: string) => {
      const tx: ethers.Transaction = ethers.Transaction.from(rlpTx);

      const txPoolTransaction: TxPoolTransaction = {
        blockHash: constants.ZERO_HEX_32_BYTE,
        blockNumber: null,
        transactionIndex: null,
        from: tx.from,
        gas: numberTo0x(tx.gasLimit),
        hash: tx.hash,
        input: tx.data,
        nonce: numberTo0x(tx.nonce),
        to: tx.to,
        value: numberTo0x(tx.value),
        type: numberTo0x(tx.type ?? 0),
        v: tx?.signature?.v ? numberTo0x(tx?.signature?.v) : null,
        r: tx?.signature?.r?.toString(),
        s: tx?.signature?.s?.toString(),
      } as TxPoolTransaction;

      // include optional EIP-155 and EIP-1559 fields if present
      if (tx.chainId) txPoolTransaction.chainId = numberTo0x(tx.chainId);
      if (tx.gasPrice) txPoolTransaction.gasPrice = numberTo0x(tx.gasPrice);
      if (tx.maxFeePerGas) txPoolTransaction.maxFeePerGas = numberTo0x(tx.maxFeePerGas);
      if (tx.maxPriorityFeePerGas) txPoolTransaction.maxPriorityFeePerGas = numberTo0x(tx.maxPriorityFeePerGas);

      txs.push(txPoolTransaction);
    });

    return txs;
  }

  /**
   * Groups transactions by sender address and nonce.
   *
   * @param txs - Array of transactions to group.
   * @returns Nested map of address - nonce - transaction.
   */
  private groupByAddressAndNonce(txs: TxPoolTransaction[]): TxPoolTransactionsByAddressAndNonce {
    return txs.reduce((acc: TxPoolTransactionsByAddressAndNonce, item: TxPoolTransaction) => {
      const from: string = item.from;
      const nonce: number = Number(item.nonce);

      if (!acc[from]) acc[from] = {};
      acc[from][nonce] = item;

      return acc;
    }, {});
  }

  /**
   * Groups transactions by nonce only.
   *
   * @param txs - Array of transactions to group.
   * @returns Map of nonce - transaction.
   */
  private groupByNonce(txs: TxPoolTransaction[]): TxPoolTransactionsByNonce {
    return txs.reduce((acc: TxPoolTransactionsByNonce, item: TxPoolTransaction) => {
      acc[Number(item.nonce)] = item;
      return acc;
    }, {});
  }

  @rpcMethod
  @rpcParamValidationRules({})
  async content(): Promise<TxPoolContent> {
    TxPoolImpl.requireTxPoolAPIEnabled();

    const rlpTxs = await this.txPoolService.getAllTransactions();
    const txs = this.convertRlpEncodedTxToTransactionPoolTx(rlpTxs);

    return {
      pending: this.groupByAddressAndNonce(txs),
      queued: {},
    };
  }

  @rpcMethod
  @rpcParamValidationRules({
    0: { type: 'address', required: true },
  })
  async contentFrom(address: string): Promise<TxPoolContentFrom> {
    TxPoolImpl.requireTxPoolAPIEnabled();

    const rlpTxs = await this.txPoolService.getTransactions(address);
    const txs = this.convertRlpEncodedTxToTransactionPoolTx(rlpTxs);

    return {
      pending: this.groupByNonce(txs),
      queued: {},
    };
  }

  @rpcMethod
  @rpcParamValidationRules({})
  async status(): Promise<TxPoolStatus> {
    TxPoolImpl.requireTxPoolAPIEnabled();

    const txs = await this.txPoolService.getAllTransactions();
    return {
      pending: numberTo0x(txs.length),
      queued: constants.ZERO_HEX,
    };
  }
}
