// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '@hashgraph/json-rpc-relay';

import { IJsonRpcResponse } from './IJsonRpcResponse';

export function jsonRespResult(id: string | number | null, result: unknown): IJsonRpcResponse {
  if (id !== null && typeof id !== 'string' && typeof id !== 'number') {
    throw new TypeError(`Invalid id type ${typeof id}`);
  }

  if (result === undefined) {
    throw new Error('Missing result or error');
  }

  return { result, jsonrpc: '2.0', id };
}

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

  error.message = `[Request ID: ${requestId}] ${error.message}`;
  return { error, jsonrpc: '2.0', id };
}
