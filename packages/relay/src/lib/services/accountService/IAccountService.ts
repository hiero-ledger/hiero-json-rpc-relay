// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from '../../types';
import { JsonRpcError } from '../../errors/JsonRpcError';

export interface IAccountService {
  getTransactionCount: (
    address: string,
    blockNumOrTag: string | null,
    requestDetails: RequestDetails
  ) => Promise<string | JsonRpcError>;

  getBalance: (
    account: string,
    blockNumberOrTagOrHash: string | null,
    requestDetails: RequestDetails
  ) => Promise<string>;
}
