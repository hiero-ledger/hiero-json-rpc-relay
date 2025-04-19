// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '@hashgraph/json-rpc-relay/dist';

import { JsonRpcError as JsonRpcErrorServer } from './RpcError';

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

// Map Mirror Node error codes to Relay HTTP status codes
// - MN 404 -> Relay HTTP 400
// - MN 429 -> Relay HTTP 429
// - MN 501 -> Relay HTTP 501
// - Any other error codes from the Mirror Node will be mapped to Relay HTTP 500 by default
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
export function translateRpcErrorToHttpStatus(jsonRpcError: JsonRpcError | JsonRpcErrorServer): {
  statusErrorCode: number;
  statusErrorMessage: string;
} {
  // look up status code and define error message
  let statusErrorCode = ERROR_CODE_MAP[jsonRpcError.code] || HTTP_STATUS.BAD_REQUEST;
  const statusErrorMessage = jsonRpcError.message;

  // Handle Mirror Node errors (-32020)
  // Note: -32020 corresponds to predefined.MIRROR_NODE_UPSTREAM_FAILURE,
  // where `jsonRpcError.data` represents the actual HTTP status code returned from the Mirror Node upstream server.
  if (jsonRpcError.code === -32020 && jsonRpcError.data) {
    statusErrorCode = MIRROR_NODE_ERROR_MAP[jsonRpcError.data] || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  }

  return { statusErrorCode, statusErrorMessage };
}
