// SPDX-License-Identifier: Apache-2.0

import { IHbarSpendingRecord } from './hbarSpendingRecord';
import { SubscriptionTier } from './subscriptionTier';

export interface IHbarSpendingPlan {
  id: string;
  subscriptionTier: SubscriptionTier;
  createdAt: Date;
  active: boolean;
}

export interface IDetailedHbarSpendingPlan extends IHbarSpendingPlan {
  spendingHistory: IHbarSpendingRecord[];
  amountSpent: number;
}
