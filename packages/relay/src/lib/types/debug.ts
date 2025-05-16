// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { ICallTracerConfig } from './ITracerConfig';

/**
 * Configuration object for block tracing operations.
 */
export interface BlockTracerConfig {
  /** The type of tracer to use for block tracing. */
  tracer: TracerType;
  /** Optional configuration for the call tracer. */
  tracerConfig?: ICallTracerConfig;
}

/**
 * Represents the state of an entity during a trace operation.
 */
export interface EntitytTraceState {
  /** The balance of the entity. */
  balance: string;
  /** The nonce of the entity. */
  nonce: number;
  /** The code associated with the entity, typically in hexadecimal format. */
  code: string;
  /** A mapping of storage keys to their corresponding values for the entity. */
  storage: Record<string, string>;
}

/**
 * Represents a mapping from entity identifiers to their corresponding trace state.
 *
 * @typeParam string - The key representing the unique identifier of an entity.
 * @typeParam EntitytTraceState - The value representing the trace state associated with the entity.
 */
export type EntityTraceStateMap = Record<string, EntitytTraceState>;

/**
 * Represents the result of a callTracer operation for a transaction.
 */
export interface CallTracerResult {
  /** The type of the call (e.g., 'CALL', 'CREATE', etc.). */
  type: string;
  /** The address initiating the call. */
  from: string;
  /** The address receiving the call. */
  to: string;
  /** The value transferred in the call, as a string. */
  value: string;
  /** The amount of gas provided for the call, as a string. */
  gas: string;
  /** The amount of gas used by the call, as a string. */
  gasUsed: string;
  /** The input data sent with the call, as a hex string. */
  input: string;
  /** The output data returned by the call, as a hex string. */
  output: string;
  /** Optional error message if the call failed. */
  error?: string;
  /** Optional revert reason if the call was reverted. */
  revertReason?: string;
  /** Optional array of nested call trace results, representing internal calls. */
  calls?: CallTracerResult[];
}

/**
 * Represents the result of a traceBlockByNumber operation for a single transaction.
 * The result can be either a call trace or a prestate map, depending on tracer type.
 */
export interface TraceBlockByNumberTxResult {
  /** The hash of the transaction being traced. */
  txHash: string;
  /**
   * The result of the trace, which can be either a {@link CallTracerResult} or an {@link EntityTraceStateMap}.
   */
  result: CallTracerResult | EntityTraceStateMap | null;
}
