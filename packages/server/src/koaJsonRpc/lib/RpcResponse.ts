// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '@hashgraph/json-rpc-relay';

import { IJsonRpcResponse } from './IJsonRpcResponse';

/**
 * Creates a JSON-RPC response object for a successful request.
 * It wraps the `result` in a response object with the given ID.
 * See _Response object_ https://www.jsonrpc.org/specification#response_object for more details.
 *
 * @param id - The JSON-RPC ID received in the request or `null` if the request was a notification.
 * @param result - The result of the response.
 * @returns A JSON-RPC response object.
 */
export function jsonRespResult(id: string | number | null, result: unknown): IJsonRpcResponse {
  if (id !== null && typeof id !== 'string' && typeof id !== 'number') {
    throw new TypeError(`Invalid id type ${typeof id}`);
  }

  if (result === undefined) {
    throw new Error('Missing result or error');
  }

  return { result, jsonrpc: '2.0', id };
}

/**
 * Creates a JSON-RPC error object for a `JsonRpcError`.
 * It wraps the `error` in a response object with the given ID.
 * See _Error object_ https://www.jsonrpc.org/specification#error_object for more details.
 *
 * The returned error message is prefixed with the internal `requestId`.
 * More specifically, the error message will be formatted as `[Request ID: <requestId>] <error.message>`.
 *
 * Users with an error response can report this `requestId` back to Relay operators.
 * This `requestId` is useful for debugging and troubleshooting purposes.
 * It can be used to correlate the error with the original request and its corresponding logs.
 *
 * @param id - The JSON-RPC ID received in the request or `null` if the request was a notification.
 * @param error - The error object to include in the response.
 * @param requestId - The internal request ID used for logging and tracing purposes.
 * @returns A JSON-RPC error object.
 */
export function jsonRespError(id: string | number | null, error: JsonRpcError, requestId: string): IJsonRpcResponse {
  if (id !== null && typeof id !== 'string' && typeof id !== 'number') {
    throw new TypeError(`Invalid id type ${typeof id}`);
  }

  if (typeof error.code !== 'number') {
    throw new TypeError(`Invalid error code type ${typeof error.code}`);
  }

  if (typeof error.message !== 'string') {
    throw new TypeError(`Invalid error message type ${typeof error.message}`);
  }

  // We cannot update the original `error`'s message because `error` might be reused.
  // Thus, we need to return a new `JsonRpcError` instance instead.
  return {
    error: new JsonRpcError({
      code: error.code,
      message: `[Request ID: ${requestId}] ${error.message}`,
      data: error.data,
    }),
    jsonrpc: '2.0',
    id,
  };
}
