// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from './RequestDetails';

export interface IEthExecutionEventPayload {
  method: string;
}

export interface IExecuteQueryEventPayload {
  executionMode: string;
  transactionId: string;
  txConstructorName: string;
  cost: number;
  gasUsed: number;
  status: string;
  requestDetails: RequestDetails;
  originalCallerAddress: string | undefined;
}

export interface IExecuteTransactionEventPayload {
  transactionId: string;
  transactionHash?: string;
  txConstructorName: string;
  operatorAccountId: string;
  requestDetails: RequestDetails;
  originalCallerAddress: string;
}

export interface TypedEvents {
  eth_execution: [IEthExecutionEventPayload];
  execute_query: [IExecuteQueryEventPayload];
  execute_transaction: [IExecuteTransactionEventPayload];
}
