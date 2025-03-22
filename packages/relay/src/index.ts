// SPDX-License-Identifier: Apache-2.0

import { TracerType } from './lib/constants';
import { JsonRpcError, predefined } from './lib/errors/JsonRpcError';
import { MirrorNodeClientError } from './lib/errors/MirrorNodeClientError';
import WebSocketError from './lib/errors/WebSocketError';
import { Block, Log, Receipt, Transaction } from './lib/model';
import { IContractCallRequest, IGetLogsParams, INewFilterParams, ITracerConfig, RequestDetails } from './lib/types';

export { JsonRpcError, predefined, MirrorNodeClientError, WebSocketError };

export { Relay } from './lib/relay';

export interface Subs {
  generateId(): string;

  subscribe(connection, event: string, filters?: {}): string;

  unsubscribe(connection, subscriptionId?: string): number;
}

export interface Debug {
  traceTransaction: (
    transactionIdOrHash: string,
    tracer: TracerType,
    tracerConfig: ITracerConfig,
    requestDetails: RequestDetails,
  ) => Promise<any>;
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

export interface Eth {
  blockNumber(requestDetails: RequestDetails): Promise<string>;

  call(call: any, blockParam: string | object | null, requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  coinbase(requestDetails: RequestDetails): JsonRpcError;

  estimateGas(
    transaction: IContractCallRequest,
    blockParam: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError>;

  gasPrice(requestDetails: RequestDetails): Promise<string>;

  getBalance(account: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<string>;

  getBlockByHash(hash: string, showDetails: boolean, requestDetails: RequestDetails): Promise<Block | null>;

  getBlockByNumber(blockNum: string, showDetails: boolean, requestDetails: RequestDetails): Promise<Block | null>;

  getBlockTransactionCountByHash(hash: string, requestDetails: RequestDetails): Promise<string | null>;

  getBlockTransactionCountByNumber(blockNum: string, requestDetails: RequestDetails): Promise<string | null>;

  getCode(address: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<string>;

  chainId(requestDetails: RequestDetails): string;

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

  getUncleByBlockHashAndIndex(requestDetails: RequestDetails): Promise<any>;

  getUncleByBlockNumberAndIndex(requestDetails: RequestDetails): Promise<any>;

  getUncleCountByBlockHash(requestDetails: RequestDetails): Promise<string>;

  getUncleCountByBlockNumber(requestDetails: RequestDetails): Promise<string>;

  getWork(requestDetails: RequestDetails): JsonRpcError;

  feeHistory(
    blockCount: number,
    newestBlock: string,
    rewardPercentiles: Array<number> | null,
    requestDetails: RequestDetails,
  ): Promise<any>;

  hashrate(requestDetails: RequestDetails): Promise<string>;

  maxPriorityFeePerGas(requestDetails: RequestDetails): Promise<string>;

  mining(requestDetails: RequestDetails): Promise<boolean>;

  newFilter(params: INewFilterParams, requestDetails: RequestDetails): Promise<string>;

  newBlockFilter(requestDetails: RequestDetails): Promise<string>;

  getFilterLogs(filterId: string, requestDetails: RequestDetails): Promise<Log[]>;

  getFilterChanges(filterId: string, requestDetails: RequestDetails): Promise<string[] | Log[]>;

  newPendingTransactionFilter(requestDetails: RequestDetails): Promise<JsonRpcError>;

  uninstallFilter(filterId: string, requestDetails: RequestDetails): Promise<boolean>;

  protocolVersion(requestDetails: RequestDetails): JsonRpcError;

  sendRawTransaction(transaction: string, requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  sendTransaction(requestDetails: RequestDetails): JsonRpcError;

  sign(requestDetails: RequestDetails): JsonRpcError;

  signTransaction(requestDetails: RequestDetails): JsonRpcError;

  submitHashrate(requestDetails: RequestDetails): JsonRpcError;

  submitWork(requestDetails: RequestDetails): Promise<boolean>;

  syncing(requestDetails: RequestDetails): Promise<boolean>;

  accounts(requestDetails: RequestDetails): Array<any>;
}
