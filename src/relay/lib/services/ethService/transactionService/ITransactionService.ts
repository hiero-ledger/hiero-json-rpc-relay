// SPDX-License-Identifier: Apache-2.0

import { type JsonRpcError } from '../../../errors/JsonRpcError';
import { type Transaction } from '../../../model';
import { type ITransactionReceipt, type RequestDetails } from '../../../types';

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

  getTransactionReceipt(hash: string, requestDetails: RequestDetails): Promise<ITransactionReceipt | null>;

  sendRawTransaction(transaction: string, requestDetails: RequestDetails): Promise<string | JsonRpcError>;
}
