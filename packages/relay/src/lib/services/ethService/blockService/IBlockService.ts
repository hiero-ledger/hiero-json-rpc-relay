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
  getBlockReceipts: (blockHash: string, requestDetails: RequestDetails) => Promise<ITransactionReceipt[]>;
  getUncleByBlockHashAndIndex: (requestDetails: RequestDetails) => Promise<null>;
  getUncleByBlockNumberAndIndex: (requestDetails: RequestDetails) => Promise<null>;
  getUncleCountByBlockHash: (requestDetails: RequestDetails) => Promise<string>;
  getUncleCountByBlockNumber: (requestDetails: RequestDetails) => Promise<string>;
}
