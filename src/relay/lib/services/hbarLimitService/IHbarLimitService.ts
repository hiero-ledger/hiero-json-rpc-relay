// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from '../../types';

export interface IHbarLimitService {
  resetLimiter(requestDetails: RequestDetails): Promise<void>;
  shouldLimit(
    mode: string,
    methodName: string,
    txConstructorName: string,
    evmAddress: string,
    requestDetails: RequestDetails,
    estimatedTxFee?: number,
  ): Promise<boolean>;
  addExpense(cost: number, evmAddress: string, requestDetails: RequestDetails, ipAddress?: string): Promise<void>;
  isEnabled(): boolean;
}
