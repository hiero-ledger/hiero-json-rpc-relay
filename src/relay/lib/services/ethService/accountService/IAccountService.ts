// SPDX-License-Identifier: Apache-2.0

import { type JsonRpcError } from '../../../errors/JsonRpcError';
import type { IAccountInfo, RequestDetails } from '../../../types';

export interface IAccountService {
  getTransactionCount: (
    address: string,
    blockNumOrTag: string,
    requestDetails: RequestDetails,
  ) => Promise<string | JsonRpcError>;

  getBalance: (account: string, blockNumberOrTagOrHash: string, requestDetails: RequestDetails) => Promise<string>;

  getTransactionCounts: (
    account: string,
    requestDetails: RequestDetails,
  ) => Promise<{ pendingCount: number; confirmedCount: number; mirrorNodeArtifact: IAccountInfo | null }>;
}
