// SPDX-License-Identifier: Apache-2.0
import { Log } from '../../../model';

/**
 * Parameters specific to creating a synthetic transaction receipt from logs
 */
interface ISyntheticTransactionReceiptParams {
  syntheticLogs: Log[];
  gasPriceForTimestamp: string;
}

/**
 * Parameters specific to creating a regular transaction receipt from mirror node data
 */
interface IRegularTransactionReceiptParams {
  effectiveGas: string;
  from: string;
  logs: Log[];
  receiptResponse: any;
  to: string;
}

export { ISyntheticTransactionReceiptParams, IRegularTransactionReceiptParams };
