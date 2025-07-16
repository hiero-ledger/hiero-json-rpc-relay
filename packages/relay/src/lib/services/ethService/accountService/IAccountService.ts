// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '../../../errors/JsonRpcError';
import { RequestDetails } from '../../../types';

export interface IAccountService {
  getTransactionCount: (
    address: string,
    blockNumOrTag: string,
    requestDetails: RequestDetails,
  ) => Promise<string | JsonRpcError>;

  getBalance: (
    account: string,
    blockNumberOrTagOrHash: string | null,
    requestDetails: RequestDetails,
  ) => Promise<string>;
}
