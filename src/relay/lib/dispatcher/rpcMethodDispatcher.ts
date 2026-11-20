// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { type Counter, Registry } from 'prom-client';

import { createMethodMetricLabeler, METRICS, MetricsFactory } from '../../../metrics';
import { Utils } from '../../utils';
import { JsonRpcError } from '../errors/JsonRpcError';
import { predefined } from '../errors/JsonRpcError';
import { MirrorNodeClientError } from '../errors/MirrorNodeClientError';
import { logRpcError, toJsonRpcError } from '../errors/rpcErrorReporting';
import { SDKClientError } from '../errors/SDKClientError';
import { type OperationHandler, type RequestDetails, type RpcMethodRegistry } from '../types';
import { isRequestAbortedError } from '../utils/requestAbort';
import { RPC_PARAM_VALIDATION_RULES_KEY, validateParams } from '../validators';

/**
 * Dispatches JSON-RPC method calls to their appropriate handlers
 *
 * This class is responsible for:
 * - Validating incoming RPC method requests
 * - Routing requests to the correct operation handler
 * - Processing method parameters
 * - Handling errors that occur during method execution
 * - Returning properly formatted responses
 */
export class RpcMethodDispatcher {
  private readonly consensusNodeErrorsCounter: Counter;
  private readonly rpcErrorsCounter: Counter;
  private readonly methodMetricLabeler: (method: unknown) => string;

  /**
   * Creates a new RpcMethodDispatcher
   *
   * @param methodRegistry - Map of RPC method names to their implementations
   * @param logger - Logger for recording execution information
   * @param register - Prometheus metrics registry
   * @param methodMetricLabeler - Maps a method name to a bounded metric label; defaults to the registered methods
   */
  constructor(
    private readonly methodRegistry: RpcMethodRegistry,
    private readonly logger: Logger,
    register: Registry = new Registry(),
    methodMetricLabeler?: (method: unknown) => string,
  ) {
    const metricsFactory = new MetricsFactory(register);
    this.consensusNodeErrorsCounter = metricsFactory.counter(METRICS.consensusNode.errors);
    this.rpcErrorsCounter = metricsFactory.counter(METRICS.rpc.errors);
    this.methodMetricLabeler = methodMetricLabeler ?? createMethodMetricLabeler(methodRegistry.keys(), 0);
  }

  /**
   * Dispatches an RPC method call to the appropriate operation handler
   *
   * This is the core method that handles the complete lifecycle of an RPC request:
   * 1. Pre-execution: Validates the method exists and its parameters
   * 2. Execution: Processes the method with the appropriate handler
   * 3. Error handling: Catches and formats any errors that occur
   *
   * @param rpcMethodName - The name of the RPC method to execute (e.g., "eth_blockNumber")
   * @param rpcMethodParams - The parameters of the RPC method to execute, normalised to `[]` when absent or `null`
   * @param requestDetails - Additional details about the request context
   * @returns Promise that resolves to the method execution result or a JsonRpcError instance
   */
  public async dispatch(
    rpcMethodName: string,
    rpcMethodParams: unknown[] | null | undefined = [],
    requestDetails: RequestDetails,
  ): Promise<unknown> {
    // a JS default only covers `undefined`, so `params: null` has to be normalised here
    rpcMethodParams ??= [];

    try {
      /////////////////////////////// Pre-execution Phase ///////////////////////////////
      const operationHandler = this.precheckRpcMethod(rpcMethodName, rpcMethodParams);

      /////////////////////////////// Execution Phase ///////////////////////////////
      return await this.processRpcMethod(operationHandler, rpcMethodParams, requestDetails);
    } catch (error) {
      /////////////////////////////// Error Handling Phase ///////////////////////////////
      return this.handleRpcMethodError(error, rpcMethodName, rpcMethodParams);
    }
  }

  /**
   * Prechecks that the requested RPC method exists and its parameters are valid
   *
   * This method performs two key validation steps:
   * 1. Checks if the method exists in the registry
   * 2. Validates the method parameters against any defined schemas
   *
   * @param rpcMethodName - The name of the RPC method to validate
   * @param rpcMethodParams - The parameters to validate against the method's schema
   * @returns The operation handler for the requested method
   * @throws {JsonRpcError} If the method doesn't exist or parameters are invalid
   */
  private precheckRpcMethod(rpcMethodName: string, rpcMethodParams: unknown[]): OperationHandler {
    // Validate RPC method existence
    const operationHandler = this.methodRegistry.get(rpcMethodName);

    if (!operationHandler) {
      this.logger.debug(`RPC method not found in registry: rpcMethodName=%s`, rpcMethodName);

      throw this.throwUnregisteredRpcMethods(rpcMethodName);
    }

    // Validate RPC method parameters
    const methodParamSchemas = operationHandler[RPC_PARAM_VALIDATION_RULES_KEY];

    if (methodParamSchemas) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `Validating method parameters for %s, params: %s`,
          rpcMethodName,
          JSON.stringify(rpcMethodParams),
        );
      }
      validateParams(rpcMethodParams, methodParamSchemas);
    }

    return operationHandler;
  }

  /**
   * Processes an RPC method by executing its operation handler with the provided parameters
   *
   * This method:
   * 1. Rearranges the arguments as needed for the specific operation handler
   * 2. Executes the handler with the prepared arguments
   *
   * @param operationHandler - The function that implements the RPC method
   * @param rpcMethodParams - The parameters passed to the RPC method
   * @param requestDetails - Additional context about the request
   * @returns Promise resolving to the result of the operation handler
   */
  private async processRpcMethod(
    operationHandler: OperationHandler,
    rpcMethodParams: unknown[],
    requestDetails: RequestDetails,
  ): Promise<unknown> {
    // Rearrange the parameters as needed for the specific operation handler
    const rearrangedParams = Utils.arrangeRpcParams(operationHandler, rpcMethodParams, requestDetails);

    // Execute the operation handler with the rearranged parameters
    const result = await operationHandler(...rearrangedParams);

    // *Note: In some cases, the operation handler may return an exception instead of throwing.
    // To ensure proper and centralized error handling in the dispatcher, preserve and rethrow the error,
    // regardless of whether the operation handler returns or throws it.
    if (result instanceof JsonRpcError || result instanceof SDKClientError || result instanceof MirrorNodeClientError) {
      throw result;
    }

    return result;
  }

  /**
   * Handles errors that occur during RPC method execution
   *
   * The error is first mapped to the JsonRpcError returned to the client (see {@link toJsonRpcError}):
   * - JsonRpcError instances are returned as-is
   * - SDKClientError instances become REQUEST_TIMEOUT or CONSENSUS_NODE_ERROR
   * - MirrorNodeClientError instances become MIRROR_NODE_UPSTREAM_FAIL
   * - All other errors, unexpected exceptions, become INTERNAL_ERROR
   *
   * The log level is then decided on the resulting error: client errors are logged at DEBUG with the full
   * params, everything else at ERROR with the cause's stack and a summary of the params (see {@link logRpcError}).
   * Every error is counted in `rpc_relay_rpc_errors_total` by method, code and class.
   *
   * @param error - The error that occurred during method execution
   * @param rpcMethodName - The name of the RPC method that failed
   * @param rpcMethodParams - The parameters the RPC method was called with
   * @returns A JsonRpcError instance with appropriate error code and message
   */
  private handleRpcMethodError(error: unknown, rpcMethodName: string, rpcMethodParams: unknown[]): JsonRpcError {
    if (isRequestAbortedError(error)) {
      this.logger.debug(`Method execution cancelled by the caller: rpcMethodName=%s`, rpcMethodName);
      throw error;
    }

    if (error instanceof SDKClientError) {
      this.consensusNodeErrorsCounter.labels(error.status.toString()).inc(1);
    }

    const jsonRpcError = toJsonRpcError(error);
    const errorClass = logRpcError(this.logger, rpcMethodName, rpcMethodParams, jsonRpcError, error);
    this.rpcErrorsCounter.labels(this.methodMetricLabeler(rpcMethodName), String(jsonRpcError.code), errorClass).inc();

    return jsonRpcError;
  }

  /**
   * Determines the appropriate error to throw for unregistered RPC methods
   *
   * This method categorizes unregistered methods into different types:
   * - Engine namespace methods (intentionally unsupported)
   * - Trace/debug namespace methods (planned but not implemented)
   * - Truly unknown methods
   *
   * @param methodName - The name of the unregistered RPC method
   * @throws {JsonRpcError} With the appropriate error code and message for the method type
   */
  private throwUnregisteredRpcMethods(methodName: string): never {
    // Methods from the 'engine_' namespace are intentionally unsupported
    if (/^engine_.*/.test(methodName)) {
      throw predefined.UNSUPPORTED_METHOD;
    }

    // Methods from 'trace_' or 'debug_' (other than 'debug_traceTransaction') namespaces are not yet implemented
    if (/^(?:trace_|debug_).*/.test(methodName)) {
      throw predefined.NOT_YET_IMPLEMENTED;
    }

    // Default response for truly unknown methods
    throw predefined.METHOD_NOT_FOUND(methodName);
  }
}
