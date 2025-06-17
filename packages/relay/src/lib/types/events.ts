// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from './RequestDetails';

export interface IExecuteTransactionEventPayload {
  transactionId: string;
  callerName: string;
  txConstructorName: string;
  operatorAccountId: string;
  interactingEntity: string;
  requestDetails: RequestDetails;
  originalCallerAddress: string;
}

export interface IExecuteQueryEventPayload {
  executionMode: string;
  transactionId: string;
  txConstructorName: string;
  callerName: string;
  cost: number;
  gasUsed: number;
  interactingEntity: string;
  status: string;
  requestDetails: RequestDetails;
  originalCallerAddress: string | undefined;
}

export interface IEthExecutionEventPayload {
  method: string;
  requestDetails: RequestDetails;
}
