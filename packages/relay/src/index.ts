// SPDX-License-Identifier: Apache-2.0
import { JsonRpcError, predefined } from './lib/errors/JsonRpcError';
import { MirrorNodeClientError } from './lib/errors/MirrorNodeClientError';
import WebSocketError from './lib/errors/WebSocketError';
import { Block, Log, Receipt, Transaction } from './lib/model';
import { TxPoolContent, TxPoolContentFrom, TxPoolStatus } from './lib/txpool';
import {
  BlockTracerConfig,
  IContractCallRequest,
  IGetLogsParams,
  INewFilterParams,
  ITransactionReceipt,
  RequestDetails,
  TransactionTracerConfig,
} from './lib/types';

export { JsonRpcError, predefined, MirrorNodeClientError, WebSocketError };

export { Relay } from './lib/relay';

export interface Debug {
  traceTransaction: (
    transactionIdOrHash: string,
    tracerObject: TransactionTracerConfig,
    requestDetails: RequestDetails,
  ) => Promise<any>;

  traceBlockByNumber(
    blockNumber: string,
    tracerObject: BlockTracerConfig,
    requestDetails: RequestDetails,
  ): Promise<any>;

  getBadBlocks(): Promise<[]>;

  getRawBlock(blockNrOrHash: string, requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  traceBlockByHash(blockHash: string, tracerObject: BlockTracerConfig, requestDetails: RequestDetails): Promise<any>;
}

export interface Web3 {
  clientVersion(): string;

  sha3(input: string): string;
}

export interface Net {
  listening(): boolean;

  version(): string;

  peerCount(): JsonRpcError;
}

export interface Admin {
  config(): any;
}

export interface TxPool {
  content(): Promise<TxPoolContent | JsonRpcError>;

  contentFrom(address: string): Promise<TxPoolContentFrom | JsonRpcError>;

  status(): Promise<TxPoolStatus | JsonRpcError>;
}

export interface Eth {
  blockNumber(requestDetails: RequestDetails): Promise<string>;

  call(call: any, blockParam: string | object | null, requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  coinbase(): JsonRpcError;

  simulateV1(): JsonRpcError;

  blobBaseFee(): JsonRpcError;

  estimateGas(
    transaction: IContractCallRequest,
    blockParam: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError>;

  gasPrice(requestDetails: RequestDetails): Promise<string>;

  getBalance(account: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<string>;

  getBlockReceipts(blockHashOrNumber: string, requestDetails: RequestDetails): Promise<ITransactionReceipt[] | null>;

  getBlockByHash(hash: string, showDetails: boolean, requestDetails: RequestDetails): Promise<Block | null>;

  getBlockByNumber(blockNum: string, showDetails: boolean, requestDetails: RequestDetails): Promise<Block | null>;

  getBlockTransactionCountByHash(hash: string, requestDetails: RequestDetails): Promise<string | null>;

  getBlockTransactionCountByNumber(blockNum: string, requestDetails: RequestDetails): Promise<string | null>;

  getCode(address: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<string | null>;

  chainId(): string;

  getLogs(params: IGetLogsParams, requestDetails: RequestDetails): Promise<Log[]>;

  getStorageAt(
    address: string,
    slot: string,
    blockNumber: string | null,
    requestDetails: RequestDetails,
  ): Promise<string>;

  getTransactionByBlockHashAndIndex(
    hash: string,
    index: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null>;

  getTransactionByBlockNumberAndIndex(
    blockNum: string,
    index: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null>;

  getTransactionByHash(hash: string, requestDetails: RequestDetails): Promise<Transaction | null>;

  getTransactionCount(
    address: string,
    blockNum: string,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError>;

  getTransactionReceipt(hash: string, requestDetails: RequestDetails): Promise<Receipt | null>;

  getUncleByBlockHashAndIndex(blockHash: string, index: string): null;

  getUncleByBlockNumberAndIndex(blockNumOrTag: string, index: string): null;

  getUncleCountByBlockHash(blockHash: string): string;

  getUncleCountByBlockNumber(blockNumOrTag: string): string;

  getWork(): JsonRpcError;

  feeHistory(
    blockCount: number,
    newestBlock: string,
    rewardPercentiles: Array<number> | null,
    requestDetails: RequestDetails,
  ): Promise<any>;

  hashrate(): Promise<string>;

  maxPriorityFeePerGas(): Promise<string>;

  mining(requestDetails: RequestDetails): Promise<boolean>;

  newFilter(params: INewFilterParams, requestDetails: RequestDetails): Promise<string>;

  newBlockFilter(requestDetails: RequestDetails): Promise<string>;

  getFilterLogs(filterId: string, requestDetails: RequestDetails): Promise<Log[]>;

  getFilterChanges(filterId: string, requestDetails: RequestDetails): Promise<string[] | Log[]>;

  newPendingTransactionFilter(): JsonRpcError;

  uninstallFilter(filterId: string, requestDetails: RequestDetails): Promise<boolean>;

  protocolVersion(): JsonRpcError;

  sendRawTransaction(transaction: string, requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  sendTransaction(): JsonRpcError;

  sign(): JsonRpcError;

  signTransaction(): JsonRpcError;

  submitHashrate(): JsonRpcError;

  submitWork(): Promise<boolean>;

  syncing(): Promise<boolean>;

  accounts(requestDetails: RequestDetails): Array<any>;

  getProof(): JsonRpcError;

  createAccessList(): JsonRpcError;
}
