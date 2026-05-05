// SPDX-License-Identifier: Apache-2.0

import { type JsonRpcError } from '../../../errors/JsonRpcError';
import { type IFeeHistory, type RequestDetails } from '../../../types';

export interface IFeeService {
  feeHistory: (
    blockCount: number,
    newestBlock: string,
    rewardPercentiles: Array<number> | null,
    requestDetails: RequestDetails,
  ) => Promise<IFeeHistory | JsonRpcError>;

  maxPriorityFeePerGas: (requestDetails: RequestDetails) => Promise<string>;
}
