// SPDX-License-Identifier: Apache-2.0

import { Log } from '../../../model';
import { IAccountInfo, IContractCallRequest, RequestDetails } from '../../../types';

export interface ICommonService {
  addTopicsToParams(params: any, topics: any[] | null): void;

  blockTagIsLatestOrPending(tag: any): boolean;

  gasPrice(requestDetails: RequestDetails): Promise<string>;

  genericErrorHandler(error: any, logMessage?: string): void;

  getAccount(address: string, requestDetails: RequestDetails): Promise<IAccountInfo | null>;

  getContractAddressFromReceipt(contractResult: any): string;

  getCurrentGasPriceForBlock(block: string, requestDetails: RequestDetails): Promise<string>;

  getGasPriceInWeibars(requestDetails: RequestDetails, timestamp?: string): Promise<number>;

  getHistoricalBlockResponse(
    requestDetails: RequestDetails,
    blockNumberOrTag?: string | null,
    returnLatest?: boolean,
  ): Promise<any>;

  getLatestBlockNumber(requestDetails: RequestDetails): Promise<string>;

  getLogs(
    blockHash: string | null,
    fromBlock: string | 'latest',
    toBlock: string | 'latest',
    address: string | string[] | null,
    topics: any[] | null,
    requestDetails: RequestDetails,
  ): Promise<Log[]>;

  getLogsByAddress(address: string | [string], params: any, requestDetails: RequestDetails): Promise<any>;

  getLogsWithParams(address: string | [string] | null, params: any, requestDetails: RequestDetails): Promise<Log[]>;

  isBlockHash(blockHash: string): boolean;

  isBlockParamValid(tag: string | null): boolean;

  resolveEvmAddress(address: string, requestDetails: RequestDetails, types?: string[]): Promise<string>;

  translateBlockTag(tag: string | null, requestDetails: RequestDetails): Promise<number>;

  validateBlockHashAndAddTimestampToParams(
    params: any,
    blockHash: string,
    requestDetails: RequestDetails,
  ): Promise<boolean>;

  validateBlockRange(fromBlock: string, toBlock: string, requestDetails: RequestDetails): Promise<boolean>;

  validateBlockRangeAndAddTimestampToParams(
    params: any,
    fromBlock: string,
    toBlock: string,
    requestDetails: RequestDetails,
    address?: string | string[] | null,
  ): Promise<boolean>;
}
