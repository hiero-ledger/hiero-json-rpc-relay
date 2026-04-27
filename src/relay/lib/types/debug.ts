// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { ICallTracerConfig, ITracerConfig } from './ITracerConfig';
import { ContractAction, MirrorNodeContractResult } from './mirrorNode';

/**
 * Configuration object for block tracing operations.
 */
interface TracerConfig<T extends ITracerConfig = ITracerConfig> {
  /** The type of tracer to use for tracing. */
  tracer: TracerType;
  /** Optional configuration for the tracer. */
  tracerConfig?: T;
}

// Public exports
export type BlockTracerConfig = TracerConfig<ICallTracerConfig>;
export type TransactionTracerConfig = TracerConfig<ITracerConfig>;

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
 * Represents a single operation in the opcode execution trace.
 */
export interface StructLog {
  /** Program counter position. */
  pc?: number;
  /** Operation code. */
  op?: string;
  /** Gas remaining at this step. */
  gas?: number;
  /** Cost of this operation. */
  gasCost?: number;
  /** Call depth. */
  depth?: number;
  /** Stack contents (if stack tracking enabled), null if disabled. */
  stack?: string[] | null;
  /** Memory contents (if memory tracking enabled), null if disabled. */
  memory?: string[] | null;
  /** Storage state (if storage tracking enabled), null if disabled. */
  storage?: Record<string, string> | null;
  /** Optional reason for operation result. */
  reason?: string | null;
}

/**
 * Represents the result of an opcodeLogger trace operation.
 */
export interface OpcodeLoggerResult {
  /** Total gas consumed by the transaction. */
  gas?: number;
  /** Whether the transaction execution failed. */
  failed?: boolean;
  /** The return value from the transaction execution. */
  returnValue?: string;
  /** Array of operation logs representing the execution trace. */
  structLogs?: StructLog[];
}

/**
 * Represents the result of a block trace operation for a single transaction.
 * The result can be either a call trace or a prestate map, depending on tracer type.
 */
export interface TraceBlockTxResult {
  /** The hash of the transaction being traced. */
  txHash: string;
  /**
   * The result of the trace, which can be either a {@link CallTracerResult} or an {@link EntityTraceStateMap}.
   */
  result: CallTracerResult | EntityTraceStateMap | null;
}

/**
 * Represents map of a transaction hash and its associated contract result and/or contract actions.
 */
export type TxHashToContractResultOrActionsMap = Record<
  string,
  { contractResult?: MirrorNodeContractResult; actions?: ContractAction[] }
>;
