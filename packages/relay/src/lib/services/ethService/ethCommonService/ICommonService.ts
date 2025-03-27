// SPDX-License-Identifier: Apache-2.0

import { Log } from '../../../model';
import { RequestDetails } from '../../../types';

export interface ICommonService {
  blockTagIsLatestOrPending(tag: any): boolean;

  validateBlockRangeAndAddTimestampToParams(
    params: any,
    fromBlock: string,
    toBlock: string,
    requestDetails: RequestDetails,
    address?: string | string[] | null,
  ): Promise<boolean>;

  getHistoricalBlockResponse(
    requestDetails: RequestDetails,
    blockNumberOrTag?: string | null,
    returnLatest?: boolean,
  ): Promise<any>;

  getLatestBlockNumber(requestDetails: RequestDetails): Promise<string>;

  genericErrorHandler(error: any, logMessage?: string): void;

  validateBlockHashAndAddTimestampToParams(
    params: any,
    blockHash: string,
    requestDetails: RequestDetails,
  ): Promise<boolean>;

  addTopicsToParams(params: any, topics: any[] | null): void;

  getLogsByAddress(address: string | [string], params: any, requestDetails: RequestDetails): Promise<any>;

  getLogsWithParams(address: string | [string] | null, params: any, requestDetails: RequestDetails): Promise<Log[]>;

  getLogs(
    blockHash: string | null,
    fromBlock: string | 'latest',
    toBlock: string | 'latest',
    address: string | [string] | null,
    topics: any[] | null,
    requestDetails: RequestDetails,
  ): Promise<Log[]>;

  getFeeWeibars(callerName: string, requestDetails: RequestDetails, timestamp?: string): Promise<number>;

  gasPrice(requestDetails: RequestDetails): Promise<string>;

  translateBlockTag(tag: string | null, requestDetails: RequestDetails): Promise<number>;
}
