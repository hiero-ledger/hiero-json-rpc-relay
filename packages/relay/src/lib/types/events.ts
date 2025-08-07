// SPDX-License-Identifier: Apache-2.0

import EventEmitter from 'events';

import constants from '../constants';
import { IEthExecutionEventPayload, IExecuteQueryEventPayload, IExecuteTransactionEventPayload } from './sdkClient';

export interface TypedEvents {
  [constants.EVENTS.ETH_EXECUTION]: [IEthExecutionEventPayload];
  [constants.EVENTS.EXECUTE_QUERY]: [IExecuteQueryEventPayload];
  [constants.EVENTS.EXECUTE_TRANSACTION]: [IExecuteTransactionEventPayload];
}

export type CustomEventEmitter = EventEmitter<TypedEvents>;
