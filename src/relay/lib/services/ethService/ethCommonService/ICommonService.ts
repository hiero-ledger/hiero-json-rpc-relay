// SPDX-License-Identifier: Apache-2.0

import { type Log } from '../../../model';
import {
  type IAccountInfo,
  type MirrorNodeContractLog,
  type MirrorNodeContractResultBase,
  type RequestDetails,
} from '../../../types';
import { type LogTopic } from '../../../types/requestParams';

export interface ICommonService {
  addTopicsToParams(params: any, topics: LogTopic[] | null): void;

  blockTagIsLatestOrPending(tag: any): boolean;

  gasPrice(requestDetails: RequestDetails): Promise<string>;

  genericErrorHandler(error: any, logMessage?: string): void;

  getAccount(address: string, requestDetails: RequestDetails): Promise<IAccountInfo | null>;

  getContractAddressFromReceipt(contractResult: MirrorNodeContractResultBase): string | null;

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
    topics: LogTopic[] | null,
    requestDetails: RequestDetails,
  ): Promise<Log[]>;

  getLogsByAddress(
    address: string | string[],
    params: any,
    requestDetails: RequestDetails,
    sliceCount?: number,
  ): Promise<MirrorNodeContractLog[]>;

  getLogsWithParams(
    address: string | string[] | null,
    params: any,
    requestDetails: RequestDetails,
    sliceCount?: number,
  ): Promise<Log[]>;

  isBlockParamValid(tag: string | null): boolean;

  resolveEvmAddress(address: string | null, requestDetails: RequestDetails, types?: string[]): Promise<string | null>;

  translateBlockTag(tag: string | null, requestDetails: RequestDetails): Promise<number>;

  validateBlockHashAndAddTimestampToParams(
    params: any,
    blockHash: string,
    requestDetails: RequestDetails,
    sliceCountWrapper?: { value: number },
  ): Promise<boolean>;

  validateBlockRange(fromBlock: string, toBlock: string, requestDetails: RequestDetails): Promise<boolean>;

  validateBlockRangeAndAddTimestampToParams(
    params: any,
    fromBlock: string,
    toBlock: string,
    requestDetails: RequestDetails,
    address?: string | string[] | null,
    sliceCountOutput?: { value: number },
  ): Promise<boolean>;
}
