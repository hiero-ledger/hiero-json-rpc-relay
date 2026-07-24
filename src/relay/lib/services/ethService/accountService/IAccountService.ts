// SPDX-License-Identifier: Apache-2.0

import { type JsonRpcError } from '../../../errors/JsonRpcError';
import type { IAccountInfo, RequestDetails } from '../../../types';

export interface IAccountService {
  /**
   * Get transaction counts associated with an account.
   *
   * @param {string} address The account address
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  getTransactionCount: (
    address: string,
    blockNumOrTag: string,
    requestDetails: RequestDetails,
  ) => Promise<string | JsonRpcError>;

  /**
   * Gets the balance of an account as of the given block from the mirror node.
   *
   * @param {string} account The account to get the balance from
   * @param {string} blockNumberOrTagOrHash The block number or tag or hash to get the balance from
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  getBalance: (account: string, blockNumberOrTagOrHash: string, requestDetails: RequestDetails) => Promise<string>;

  /**
   * Get transaction counts associated with an account.
   *
   * @param {string} address The account address
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  getTransactionCounts: (
    account: string,
    requestDetails: RequestDetails,
  ) => Promise<{ pendingCount: number; confirmedCount: number; mirrorNodeArtifact: IAccountInfo | null }>;
}
