// SPDX-License-Identifier: Apache-2.0

import { IHbarSpendingRecord } from '../../types/hbarLimiter/hbarSpendingRecord';

export class HbarSpendingRecord implements IHbarSpendingRecord {
  amount: number;
  timestamp: Date;

  constructor(data: IHbarSpendingRecord) {
    this.amount = data.amount;
    this.timestamp = new Date(data.timestamp);
  }
}
