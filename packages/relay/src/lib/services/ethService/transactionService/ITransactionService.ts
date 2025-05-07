// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '../../../errors/JsonRpcError';
import { Transaction } from '../../../model';
import { RequestDetails } from '../../../types';

export interface ITransactionService {
  getTransactionByBlockHashAndIndex(
    hash: string,
    index: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null>;

  getTransactionByBlockNumberAndIndex(
    blockNum: string,
    index: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null>;

  getTransactionByHash(hash: string, requestDetails: RequestDetails): Promise<Transaction | null>;

  getTransactionReceipt(hash: string, requestDetails: RequestDetails): Promise<any>;

  sendRawTransaction(transaction: string, requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  sendTransaction(requestDetails: RequestDetails): JsonRpcError;

  signTransaction(requestDetails: RequestDetails): JsonRpcError;

  sign(requestDetails: RequestDetails): JsonRpcError;
}
