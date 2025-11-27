// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ParameterizedContext } from 'koa';

interface JsonRpcSuccess {
  jsonrpc: unknown;
  id: string | number | unknown;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: unknown;
  id: string | number | unknown;
  error?: {
    code?: number;
    message: unknown;
    data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;
type JsonRpcBatch = JsonRpcResponse[];
type JsonRpcBody = JsonRpcResponse | JsonRpcBatch;

const VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE = ConfigService.get('VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE');

const isCorrectSuccess = (res: JsonRpcResponse, httpStatus: unknown) =>
  httpStatus === 200 &&
  res.jsonrpc === '2.0' &&
  hasValidId(res.id) &&
  Object.prototype.hasOwnProperty.call(res, 'result');

const hasValidId = (id: unknown) => Boolean(id !== undefined && id !== null);

const isCorrectError = (res: JsonRpcResponse, httpStatus: unknown) =>
  httpStatus !== 200 &&
  res.jsonrpc === '2.0' &&
  hasValidId(res.id) &&
  Object.prototype.hasOwnProperty.call(res, 'error') &&
  typeof (res as JsonRpcError).error?.message === 'string';

const hasCorrectResponseBody = (res: JsonRpcResponse, httpStatus: unknown) =>
  isCorrectSuccess(res, httpStatus) || isCorrectError(res, httpStatus);

const fixResponseBody = (res: Partial<JsonRpcResponse> | undefined, httpStatus: unknown) => {
  const id = hasValidId(res?.id) ? (res!.id as string | number) : null;
  if (httpStatus === 200) {
    return {
      jsonrpc: '2.0',
      id,
      result: Object.prototype.hasOwnProperty.call(res ?? {}, 'result') ? (res as JsonRpcSuccess).result : '0x',
    };
  }
  const errorObj =
    'error' in (res ?? {}) && (res as JsonRpcError).error
      ? {
          code: (res as JsonRpcError).error!.code ?? -32603,
          message: (res as JsonRpcError).error!.message,
        }
      : {
          code: -32603,
          message: 'Internal error',
        };

  return {
    jsonrpc: '2.0',
    id,
    error: errorObj,
  };
};

/**
 * Ensures a JSON-RPC response uses a valid JSON-RPC 2.0 structure.
 * Normalizes missing or invalid fields for both single and batch responses.
 * May update HTTP status depending on VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE.
 *
 * This function must be invoked in any place where Koa's `next()` might not run,
 * or where the response may bypass normal middleware cleanup - so it's not implemented as a KOA's middleware.
 *
 * @param {ParameterizedContext} ctx - Koa context containing status and body.
 */
export const jsonRpcComplianceLayer = (ctx: ParameterizedContext) => {
  const body = ctx.body as JsonRpcBody | undefined;
  if (!body) {
    ctx.body = fixResponseBody(undefined, ctx.status);
    ctx.status = VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE ? 200 : 400;
    return;
  }
  if (Array.isArray(body)) {
    // Regardless of the mode the batch requests will always return 200;
    ctx.status = 200;
    return;
  }
  if (!hasCorrectResponseBody(body, ctx.status)) ctx.body = fixResponseBody(body, ctx.status);
  if (ctx.status === 400 && VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE) ctx.status = 200;
};
