// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { Utils } from '../../utils';
import { JsonRpcError } from '../errors/JsonRpcError';
import { predefined } from '../errors/JsonRpcError';
import { MirrorNodeClientError } from '../errors/MirrorNodeClientError';
import { SDKClientError } from '../errors/SDKClientError';
import { OperationHandler, RequestDetails, RpcMethodRegistry } from '../types';

export class RpcMethodDispatcher {
  /**
   * Creates a new MethodDispatcher
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
   * This is the core method that routes requests to the appropriate operation handler
   * on the correct namespace based on the RPC method name.
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
      const operationHandler = this.validateRpcMethod(rpcMethodName, rpcMethodParams, requestDetails);

      /////////////////////////////// Execution Phase ///////////////////////////////
      const result = await this.processRpcMethod(operationHandler, rpcMethodParams, requestDetails);

      return result;
    } catch (error: any) {
      // **reminder: all handleRpcMethod() should either return a valid result or throw an error, now returning error**

      /////////////////////////////// Error Handling Phase ///////////////////////////////
      return this.handleRpcMethodError(error, rpcMethodName, requestDetails);
    }
  }

  private validateRpcMethod(
    rpcMethodName: string,
    rpcMethodParams: any[],
    requestDetails: RequestDetails,
  ): OperationHandler {
    /////////////////////////////// Validate method existance ///////////////////////////////
    // Look up operation handler in registry
    const operationHandler = this.methodRegistry.get(rpcMethodName);

    if (!operationHandler) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} RPC method not found in registry: rpcMethodName=${rpcMethodName}`,
        );
      }
      throw predefined.UNSUPPORTED_METHOD;
    }

    /////////////////////////////// Validate method arguments ///////////////////////////////

    return operationHandler;
  }

  private processRpcMethod(
    operationHandler: OperationHandler,
    rpcMethodParams: any[],
    requestDetails: RequestDetails,
  ): Promise<any> {
    // Rearrange arguments based on the method handler and their rpcMethodParams
    const rearrangeArgsFn = Utils.argsRearrangementMap[operationHandler.name] || Utils.argsRearrangementMap['default'];
    const rearrangedArgsArray = rearrangeArgsFn(rpcMethodParams, requestDetails);

    return operationHandler(...rearrangedArgsArray);
  }

  private handleRpcMethodError(error: any, rpcMethodName: string, requestDetails: RequestDetails): any {
    // Return JsonRpcError instances
    if (error instanceof JsonRpcError) {
      return new JsonRpcError(
        {
          code: error.code,
          message: error.message,
          data: error.data,
        },
        requestDetails.requestId,
      );
    }

    if (error instanceof MirrorNodeClientError) {
      // TODO: handle MirrorNodeClientError by mapping to the correct JsonRpcError
      return error;
    }

    if (error instanceof SDKClientError) {
      // TODO: handle SDKClientError by mapping to the correct JsonRpcError
      return error;
    }

    // handle unexpected errors
    this.logger.error(
      `${requestDetails.formattedRequestId} Error executing method: rpcMethodName=${rpcMethodName}, error=${error.message}`,
    );

    return predefined.INTERNAL_ERROR(error.message.toString());
  }
}
