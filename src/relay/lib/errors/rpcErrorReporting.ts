// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';

import { summarizeRpcParams } from '../utils/rpcParamsSummary';
import { type RpcErrorClass } from './errorClassification';
import { JsonRpcError, predefined } from './JsonRpcError';
import { MirrorNodeClientError } from './MirrorNodeClientError';
import { SDKClientError } from './SDKClientError';

/** How far down a `cause` chain to look for an upstream status. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Maps any error thrown while serving a JSON-RPC call to the {@link JsonRpcError} returned to the client:
 * - a {@link JsonRpcError} as is;
 * - a {@link SDKClientError} to `REQUEST_TIMEOUT` or `CONSENSUS_NODE_ERROR`, classified by Hedera status;
 * - a {@link MirrorNodeClientError} to `MIRROR_NODE_UPSTREAM_FAIL`, classified by upstream HTTP status;
 * - anything else, an unexpected exception, to `INTERNAL_ERROR` with the error as `cause`.
 *
 * @param error - The error thrown by the method.
 * @returns The error to return to the client; {@link JsonRpcError.isClientError} decides its log level.
 */
export function toJsonRpcError(error: unknown): JsonRpcError {
  if (error instanceof JsonRpcError) {
    return error;
  }

  if (error instanceof SDKClientError) {
    return error.isGrpcTimeout()
      ? predefined.REQUEST_TIMEOUT
      : predefined.CONSENSUS_NODE_ERROR(error.status.toString(), error.statusCode, error.message, error);
  }

  if (error instanceof MirrorNodeClientError) {
    return predefined.MIRROR_NODE_UPSTREAM_FAIL(
      error.statusCode,
      error.message || 'Mirror node upstream failure',
      error,
    );
  }

  const message = (error as { message?: unknown })?.message?.toString() || 'Unknown error';
  return predefined.INTERNAL_ERROR(message, error);
}

/**
 * Returns the Mirror Node HTTP status or the Hedera status of the first upstream error in a `cause` chain.
 */
function upstreamStatusOf(error: unknown): number | string | undefined {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    if (current instanceof MirrorNodeClientError) {
      return current.statusCode;
    }
    if (current instanceof SDKClientError) {
      return current.status.toString();
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * Logs a failed JSON-RPC call at the level its class calls for:
 * - client errors at `DEBUG`, with the full params;
 * - server errors at `ERROR`, with the JSON-RPC code, the upstream status, the stack of the `cause`
 *   (or of the error itself) and a summary of the params that holds no call data or raw transaction.
 *
 * The request ID and method come from the log context mixin.
 *
 * @param logger - The logger to write to.
 * @param method - The JSON-RPC method that failed.
 * @param params - The params the method was called with.
 * @param jsonRpcError - The error returned to the client, see {@link toJsonRpcError}.
 * @param error - The error originally thrown, logged as the cause when `jsonRpcError` has none of its own.
 * @returns The class of the error.
 */
export function logRpcError(
  logger: Logger,
  method: string,
  params: unknown,
  jsonRpcError: JsonRpcError,
  error: unknown = jsonRpcError,
): RpcErrorClass {
  if (jsonRpcError.isClientError) {
    logger.debug(
      { code: jsonRpcError.code, params },
      'Client error executing method %s: %s',
      method,
      jsonRpcError.message,
    );
    return 'client';
  }

  const cause = jsonRpcError.cause ?? error;
  const upstreamStatus = upstreamStatusOf(cause);
  logger.error(
    {
      err: cause,
      code: jsonRpcError.code,
      ...(upstreamStatus !== undefined && { upstreamStatus }),
      params: summarizeRpcParams(method, params),
    },
    'Error executing method %s: %s',
    method,
    jsonRpcError.message,
  );
  return 'server';
}
