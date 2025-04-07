// SPDX-License-Identifier: Apache-2.0

import { Log } from '../../../model';
import { RequestDetails } from '../../../types';

/**
 * Parameters specific to creating a synthetic transaction receipt from logs
 */
export interface ISyntheticTransactionReceiptParams {
  syntheticLogs: Log[];
  gasPriceForTimestamp: string;
}

/**
 * Parameters specific to creating a regular transaction receipt from mirror node data
 */
export interface IRegularTransactionReceiptParams {
  effectiveGas: string;
  from: string;
  logs: Log[];
  receiptResponse: any;
  to: string;
}
