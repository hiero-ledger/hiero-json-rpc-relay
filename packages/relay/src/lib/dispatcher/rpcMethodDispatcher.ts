// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { Utils } from '../../utils';
import { RPC_PARAM_VALIDATION_RULES_KEY } from '../decorators';
import { JsonRpcError } from '../errors/JsonRpcError';
import { predefined } from '../errors/JsonRpcError';
import { MirrorNodeClientError } from '../errors/MirrorNodeClientError';
import { SDKClientError } from '../errors/SDKClientError';
import { OperationHandler, RequestDetails, RpcMethodRegistry } from '../types';
import { Validator } from '../validators';

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
  /**
   * Creates a new RpcMethodDispatcher
   *
   * @param methodRegistry - Map of RPC method names to their implementations
   * @param logger - Logger for recording execution information
   */
  constructor(
    private readonly methodRegistry: RpcMethodRegistry,
    private readonly logger: Logger,
  ) {}

  /**
   * Dispatches an RPC method call to the appropriate operation handler
   *
   * This is the core method that handles the complete lifecycle of an RPC request:
   * 1. Pre-execution: Validates the method exists and its parameters
   * 2. Execution: Processes the method with the appropriate handler
   * 3. Error handling: Catches and formats any errors that occur
   *
   * @param rpcMethodName - The name of the RPC method to execute (e.g., "eth_blockNumber")
   * @param rpcMethodParams - The parameters of the RPC method to execute
   * @param requestDetails - Additional details about the request context
   * @returns Promise that resolves to the method execution result or a JsonRpcError instance
   */
  public async dispatch(
    rpcMethodName: string,
    rpcMethodParams: any[] = [],
    requestDetails: RequestDetails,
  ): Promise<any | JsonRpcError> {
    try {
      /////////////////////////////// Pre-execution Phase ///////////////////////////////
      const operationHandler = this.precheckRpcMethod(rpcMethodName, rpcMethodParams, requestDetails);

      /////////////////////////////// Execution Phase ///////////////////////////////
      return await this.processRpcMethod(operationHandler, rpcMethodParams, requestDetails);
    } catch (error: any) {
      /////////////////////////////// Error Handling Phase ///////////////////////////////
      return this.handleRpcMethodError(error, rpcMethodName, requestDetails);
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
   * @param requestDetails - Details about the request for logging purposes
   * @returns The operation handler for the requested method
   * @throws {JsonRpcError} If the method doesn't exist or parameters are invalid
   */
  private precheckRpcMethod(
    rpcMethodName: string,
    rpcMethodParams: any[],
    requestDetails: RequestDetails,
  ): OperationHandler {
    // Validate RPC method existence
    const operationHandler = this.methodRegistry.get(rpcMethodName);

    if (!operationHandler) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} RPC method not found in registry: rpcMethodName=${rpcMethodName}`,
        );
      }

      throw this.throwUnregisteredRpcMethods(rpcMethodName);
    }

    // Validate RPC method parameters
    const methodParamSchemas = operationHandler[RPC_PARAM_VALIDATION_RULES_KEY];

    if (methodParamSchemas) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${
            requestDetails.formattedRequestId
          } Validating method parameters for ${rpcMethodName}, params: ${JSON.stringify(rpcMethodParams)}`,
        );
      }
      Validator.validateParams(rpcMethodParams, methodParamSchemas);
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
    rpcMethodParams: any[],
    requestDetails: RequestDetails,
  ): Promise<any> {
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
   * This method processes different types of errors and converts them to
   * appropriate JSON-RPC error responses. It handles:
   * - JsonRpcError instances are returned as-is with the request ID attached
   * - MirrorNodeClientError instances are converted to appropriate JsonRpcError types
   *   (currently only timeout errors are specifically handled)
   * - All other errors are converted to generic INTERNAL_ERROR responses
   *
   * All errors are logged with request context for traceability.
   *
   * @param error - The error that occurred during method execution
   * @param rpcMethodName - The name of the RPC method that failed
   * @param requestDetails - Details about the request for logging and context
   * @returns A JsonRpcError instance with appropriate error code, message and request ID
   */
  private handleRpcMethodError(error: any, rpcMethodName: string, requestDetails: RequestDetails): JsonRpcError {
    const errorMessage = error?.message?.toString() || 'Unknown error';
    this.logger.error(
      `${requestDetails.formattedRequestId} Error executing method: rpcMethodName=${rpcMethodName}, error=${errorMessage}`,
    );

    // If error is already a JsonRpcError, use it directly
    if (error instanceof JsonRpcError) {
      return this.createJsonRpcError(error, requestDetails.requestId);
    }

    // Handle GRPC timeout errors
    if (error instanceof SDKClientError && error.isGrpcTimeout()) {
      return this.createJsonRpcError(predefined.REQUEST_TIMEOUT, requestDetails.requestId);
    }

    // Handle MirrorNodeClientError by mapping to the correct JsonRpcError
    if (error instanceof MirrorNodeClientError) {
      return this.createJsonRpcError(
        predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message || 'Mirror node upstream failure'),
        requestDetails.requestId,
      );
    }

    // Default to internal error for all other error types
    return this.createJsonRpcError(predefined.INTERNAL_ERROR(errorMessage), requestDetails.requestId);
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

  /**
   * Creates a new JsonRpcError with the request ID attached to assist with tracing and debugging
   */
  private createJsonRpcError(error: JsonRpcError, requestId: string): JsonRpcError {
    return new JsonRpcError(
      {
        code: error.code,
        message: error.message,
        data: error.data,
      },
      requestId,
    );
  }
}
