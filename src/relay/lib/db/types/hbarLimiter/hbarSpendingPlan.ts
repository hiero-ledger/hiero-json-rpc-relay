// SPDX-License-Identifier: Apache-2.0

import { type IHbarSpendingRecord } from './hbarSpendingRecord';
import { type SubscriptionTier } from './subscriptionTier';

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
