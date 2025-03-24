// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { RequestDetails } from '../types';
import { JsonRpcError, predefined } from './JsonRpcError';
import { MirrorNodeClientError } from './MirrorNodeClientError';

/**
 * ErrorMapperService provides centralized error handling across the application.
 *
 * This service acts as the core component of the application's error handling infrastructure,
 * automatically intercepting and processing errors from all service classes through Proxy-based
 * method wrapping. It ensures consistent error handling by:
 *
 * 1. Mapping domain-specific errors (like MirrorNodeClientError) to standardized JsonRpcError objects
 * 2. Preserving the synchronous or asynchronous nature of wrapped methods
 * 3. Providing consistent logging and context for all errors
 * 4. Centralizing error transformation logic in a single location
 *
 * When used with the Proxy pattern in RelayImpl, this service automatically wraps all service
 * methods with error handling, eliminating the need for repetitive try/catch blocks throughout
 * the codebase and ensuring that all errors are properly mapped to the appropriate JsonRpcError
 * types before being returned to clients.
 */
export class RelayGlobalErrorHandler {
  constructor(private readonly logger: Logger) {}

  /**
   * Wraps a service method with error mapping while preserving its synchronous or asynchronous behavior.
   *
   * @param method - The original service method to wrap (e.g. EthIpml.getBalance, EthIpml.getBlockByNumber, etc.)
   * @param methodName - The name of the method (for logging and context)
   * @param isAsync - Whether the method is asynchronous and returns a Promise
   * @returns A wrapped method that handles errors while preserving the original method's sync/async behavior
   */
  public createErrorHandlingProxy<T>(
    method: (...args: any[]) => T | Promise<T>,
    methodName: string,
    isAsync: boolean,
  ): (...args: any[]) => T | JsonRpcError | Promise<T | JsonRpcError> {
    if (isAsync) {
      // For async methods: Return an async function that properly awaits the result
      // and catches errors in the Promise chain
      return async (...args: any[]) => {
        try {
          return await (method as (...args: any[]) => Promise<T>)(...args);
        } catch (error) {
          return this.convertToJsonRpcError(error, args, methodName);
        }
      };
    } else {
      // For sync methods: Return a regular function that uses try/catch
      // and returns the result directly (not wrapped in a Promise)
      return (...args: any[]) => {
        try {
          return (method as (...args: any[]) => T)(...args);
        } catch (error) {
          return this.convertToJsonRpcError(error, args, methodName);
        }
      };
    }
  }

  /**
   * Converts any error to a standardized JsonRpcError.
   *
   * Handles different error types (JsonRpcError, MirrorNodeClientError, etc.)
   * and ensures they are properly converted to the appropriate JsonRpcError type.
   * Also extracts request details from arguments for logging context.
   *
   * @param error - The error to convert
   * @param args - Method arguments, used to extract RequestDetails
   * @param contextInfo - Additional context information (usually method name)
   * @returns A standardized JsonRpcError
   */
  public convertToJsonRpcError(error: any, args: any[], contextInfo?: string): JsonRpcError {
    // Special handling for configuration errors - rethrow them
    if (error.message && error.message.includes('Configuration error')) {
      throw error; // Re-throw configuration errors
    }

    const requestDetails =
      args.find((arg) => arg instanceof RequestDetails) || new RequestDetails({ requestId: '', ipAddress: '' });

    // Already a JsonRpcError, don't remap
    if (error instanceof JsonRpcError) {
      return error;
    }

    // MirrorNodeClientError mapping
    if (error instanceof MirrorNodeClientError) {
      return this.mapMirrorNodeError(error);
    }

    // @todo: implement SDK error mapping if needed

    // Log unhandled errors for debugging
    this.logger.error(
      error,
      `${requestDetails.formattedRequestId} Unhandled error in ${contextInfo || 'unknown context'}`,
    );

    // Default error case
    return predefined.INTERNAL_ERROR(error?.message || 'Unknown error');
  }

  /**
   * Maps MirrorNodeClientError to the appropriate JsonRpcError based on error type.
   *
   * Handles various error conditions from the Mirror Node (rate limits, timeouts,
   * server errors, etc.) and maps them to standardized JsonRpcError objects.
   *
   * @param error - The MirrorNodeClientError to map
   * @returns A JsonRpcError representing the Mirror Node error
   */
  private mapMirrorNodeError(error: MirrorNodeClientError): JsonRpcError {
    // Contract revert errors - 400
    if (error.isContractRevertOpcodeExecuted()) {
      return predefined.CONTRACT_REVERT(error.detail || error.message, error.data);
    }

    // Rate limiting - 429
    if (error.isRateLimit()) {
      return predefined.MIRROR_NODE_UPSTREAM_FAIL(
        MirrorNodeClientError.HttpStatusResponses.TOO_MANY_REQUESTS.statusCode,
        MirrorNodeClientError.HttpStatusResponses.TOO_MANY_REQUESTS.message,
      );
    }

    // Internal Server Error - 500
    if (error.isInternalServerError()) {
      return predefined.MIRROR_NODE_UPSTREAM_FAIL(
        MirrorNodeClientError.HttpStatusResponses.INTERNAL_SERVER_ERROR.statusCode,
        MirrorNodeClientError.HttpStatusResponses.INTERNAL_SERVER_ERROR.message,
      );
    }

    // Not Implemented - 501
    if (error.isNotSupported()) {
      return predefined.MIRROR_NODE_UPSTREAM_FAIL(
        MirrorNodeClientError.HttpStatusResponses.NOT_SUPPORTED.statusCode,
        MirrorNodeClientError.HttpStatusResponses.NOT_SUPPORTED.message,
      );
    }

    // Not Implemented - 502
    if (error.isBadGateway()) {
      return predefined.MIRROR_NODE_UPSTREAM_FAIL(
        MirrorNodeClientError.HttpStatusResponses.BAD_GATEWAY.statusCode,
        MirrorNodeClientError.HttpStatusResponses.BAD_GATEWAY.message,
      );
    }

    // Service Unavailable - 503
    if (error.isServiceUnavailable()) {
      return predefined.MIRROR_NODE_UPSTREAM_FAIL(
        MirrorNodeClientError.HttpStatusResponses.SERVICE_UNAVAILABLE.statusCode,
        MirrorNodeClientError.HttpStatusResponses.SERVICE_UNAVAILABLE.message,
      );
    }

    // Service Unavailable - 504
    if (error.isTimeout()) {
      return predefined.MIRROR_NODE_UPSTREAM_FAIL(
        MirrorNodeClientError.HttpStatusResponses.ECONNABORTED.statusCode,
        MirrorNodeClientError.HttpStatusResponses.ECONNABORTED.message,
      );
    }

    // General upstream failures based on status code
    return predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message || 'Mirror node upstream failure');
  }
}
