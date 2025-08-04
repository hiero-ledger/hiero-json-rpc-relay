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
  cost: number;
  gasUsed: number;
  status: string;
  requestDetails: RequestDetails;
  originalCallerAddress: string | undefined;
}

export interface TypedEvents {
  ETH_EXECUTION: [method: string, requestDetails: RequestDetails];
  EXECUTE_QUERY: [
    executionMode: string,
    transactionId: string,
    txConstructorName: string,
    cost: number,
    gasUsed: number,
    status: string,
    requestDetails: RequestDetails,
    originalCallerAddress: string | undefined,
  ];
  EXECUTE_TRANSACTION: [
    transactionId: string,
    callerName: string,
    txConstructorName: string,
    operatorAccountId: string,
    interactingEntity: string,
    requestDetails: RequestDetails,
    originalCallerAddress: string,
  ];
}
