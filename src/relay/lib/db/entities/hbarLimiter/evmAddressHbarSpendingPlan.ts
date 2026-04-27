// SPDX-License-Identifier: Apache-2.0

import { IEvmAddressHbarSpendingPlan } from '../../types/hbarLimiter/evmAddressHbarSpendingPlan';

export class EvmAddressHbarSpendingPlan implements IEvmAddressHbarSpendingPlan {
  evmAddress: string;
  planId: string;

  constructor(data: IEvmAddressHbarSpendingPlan) {
    this.evmAddress = data.evmAddress;
    this.planId = data.planId;
  }
}
