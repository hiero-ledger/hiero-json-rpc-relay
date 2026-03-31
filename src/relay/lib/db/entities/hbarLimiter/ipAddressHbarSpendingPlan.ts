// SPDX-License-Identifier: Apache-2.0

import { IIPAddressHbarSpendingPlan } from '../../types/hbarLimiter/ipAddressHbarSpendingPlan';

export class IPAddressHbarSpendingPlan implements IIPAddressHbarSpendingPlan {
  ipAddress: string;
  planId: string;

  constructor(data: IIPAddressHbarSpendingPlan) {
    this.ipAddress = data.ipAddress;
    this.planId = data.planId;
  }
}
