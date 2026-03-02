// SPDX-License-Identifier: Apache-2.0

import { Block } from '../../../model';
import { ITransactionReceipt, RequestDetails } from '../../../types';

export interface IBlockService {
  getBlockByNumber: (
    blockNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ) => Promise<Block | null>;
  getBlockByHash: (hash: string, showDetails: boolean, requestDetails: RequestDetails) => Promise<Block | null>;
  getBlockTransactionCountByHash: (hash: string, requestDetails: RequestDetails) => Promise<string | null>;
  getBlockTransactionCountByNumber: (blockNum: string, requestDetails: RequestDetails) => Promise<string | null>;
  getBlockReceipts: (blockHash: string, requestDetails: RequestDetails) => Promise<ITransactionReceipt[] | null>;
  getRawReceipts: (blockHashOrBlockNumber: string, requestDetails: RequestDetails) => Promise<string[]>;
  getUncleByBlockHashAndIndex: (blockHash: string, index: string) => null;
  getUncleByBlockNumberAndIndex: (blockNumOrTag: string, index: string) => null;
  getUncleCountByBlockHash: (blockHash: string) => string;
  getUncleCountByBlockNumber: (blockNumOrTag: string) => string;
}
