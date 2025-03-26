// SPDX-License-Identifier: Apache-2.0

import { Block } from '../../model';
import { RequestDetails } from '../../types';
import { ITimestamp } from '../ethService/ethCommonService/ITimestamp';

export interface IBlockService {
  getBlockByNumber: (
    blockNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ) => Promise<Block | null>;
  getBlockByHash: (hash: string, showDetails: boolean, requestDetails: RequestDetails) => Promise<Block | null>;
  getBlockTransactionCountByHash: (hash: string, requestDetails: RequestDetails) => Promise<string | null>;
  getBlockTransactionCountByNumber: (blockNum: string, requestDetails: RequestDetails) => Promise<string | null>;
  getUncleByBlockHashAndIndex: (requestDetails: RequestDetails) => Promise<null>;
  getUncleByBlockNumberAndIndex: (requestDetails: RequestDetails) => Promise<null>;
  getUncleCountByBlockHash: (requestDetails: RequestDetails) => Promise<string>;
  getUncleCountByBlockNumber: (requestDetails: RequestDetails) => Promise<string>;
}

export interface IBlockMirrorNode {
  count: number;
  gas_used: number;
  hapi_version: string;
  hash: string;
  logs_bloom: string;
  name: string;
  number: number;
  previous_hash: string;
  size: number;
  timestamp: ITimestamp;
}