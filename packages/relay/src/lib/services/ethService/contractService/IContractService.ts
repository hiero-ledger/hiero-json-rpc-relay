// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '../../../errors/JsonRpcError';
import { Log } from '../../../model';
import { IContractCallRequest, IGetLogsParams, RequestDetails } from '../../../types';

export interface IContractService {
  /**
   * Returns an array of addresses owned by client.
   */
  accounts: (requestDetails: RequestDetails) => never[];

  /**
   * Executes a new message call immediately without creating a transaction.
   */
  call: (
    call: IContractCallRequest,
    blockParam: string | object | null,
    requestDetails: RequestDetails,
  ) => Promise<string | JsonRpcError>;

  /**
   * Returns the compiled smart contract code at a given address.
   */
  getCode: (address: string, blockNumber: string | null, requestDetails: RequestDetails) => Promise<string>;

  /**
   * Returns an array of all logs matching the filter criteria.
   */
  getLogs: (params: IGetLogsParams, requestDetails: RequestDetails) => Promise<Log[]>;

  /**
   * Returns the value from a storage position at a given address.
   */
  getStorageAt: (
    address: string,
    slot: string,
    blockNumberOrTagOrHash: string,
    requestDetails: RequestDetails,
  ) => Promise<string>;

  /**
   * Estimates the amount of gas required to execute a contract call.
   */
  estimateGas: (
    transaction: IContractCallRequest,
    blockParam: string | null,
    requestDetails: RequestDetails,
  ) => Promise<string | JsonRpcError>;
}
