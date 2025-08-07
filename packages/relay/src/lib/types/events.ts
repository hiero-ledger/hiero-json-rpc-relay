// SPDX-License-Identifier: Apache-2.0

import { IEthExecutionEventPayload, IExecuteQueryEventPayload, IExecuteTransactionEventPayload } from './sdkClient';

export interface TypedEvents {
  eth_execution: [IEthExecutionEventPayload];
  execute_query: [IExecuteQueryEventPayload];
  execute_transaction: [IExecuteTransactionEventPayload];
}
