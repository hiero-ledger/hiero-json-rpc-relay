// SPDX-License-Identifier: Apache-2.0

// Define constants for frequently used values
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
};

// Direct mapping from RPC error codes to HTTP status codes
const ERROR_CODE_MAP: Record<number, number> = {
  3: HTTP_STATUS.OK, // Contract revert
  [-32603]: HTTP_STATUS.INTERNAL_SERVER_ERROR, // Internal error
  [-32600]: HTTP_STATUS.BAD_REQUEST, // Invalid request
  [-32602]: HTTP_STATUS.BAD_REQUEST, // Invalid params
  [-32601]: HTTP_STATUS.BAD_REQUEST, // Method not found
  [-32605]: HTTP_STATUS.TOO_MANY_REQUESTS, // Rate limit exceeded
};

// Map Mirror Node error data to HTTP status codes
// - 404 from the Mirror Node maps to HTTP 400
// - 429 from the Mirror Node maps to HTTP 429
// - 501 from the Mirror Node maps to HTTP 501
// - Any other error data from the Mirror Node will be mapped to HTTP 500 by default
const MIRROR_NODE_ERROR_MAP: Record<string, number> = {
  '404': HTTP_STATUS.BAD_REQUEST,
  '429': HTTP_STATUS.TOO_MANY_REQUESTS,
  '501': HTTP_STATUS.NOT_IMPLEMENTED,
};

/**
 * Translates JSON-RPC errors to appropriate HTTP responses
 *
 * @param errorCode - JSON-RPC error code
 * @param errorMessage - JSON-RPC error message
 * @param requestIdPrefix - Request ID prefix to remove from message
 * @param errorData - Optional error data
 * @returns HTTP status code and status error description
 */
export function translateRpcErrorToHttpStatus(
  errorCode: number,
  errorMessage: string,
  requestIdPrefix: string,
  errorData?: string,
): { statusCode: number; statusErrorMessage: string } {
  // Clean the error message by removing request ID prefix
  const statusErrorMessage = errorMessage.replace(`${requestIdPrefix} `, '');

  // Handle Mirror Node errors (-32020)
  // Note: -32020 corresponds to predefined.MIRROR_NODE_UPSTREAM_FAILURE,
  // where `errorData` represents the HTTP status code returned from the Mirror Node upstream server.
  if (errorCode === -32020 && errorData) {
    return {
      statusCode: MIRROR_NODE_ERROR_MAP[errorData] || HTTP_STATUS.INTERNAL_SERVER_ERROR,
      statusErrorMessage,
    };
  }

  // Look up the status code from the map, default to BAD_REQUEST
  const statusCode = ERROR_CODE_MAP[errorCode] || HTTP_STATUS.BAD_REQUEST;

  return { statusCode, statusErrorMessage };
}
