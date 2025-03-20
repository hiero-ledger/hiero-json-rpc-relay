// SPDX-License-Identifier: Apache-2.0
import { Block } from '../../model';
import { RequestDetails } from '../../types';

export interface IBlockService {
  getBlockByNumber: (blockNumber: number) => Promise<Block>;
  getBlockByHash: (hash: string, showDetails: boolean, requestDetails: RequestDetails) => Promise<Block | null>;
}
