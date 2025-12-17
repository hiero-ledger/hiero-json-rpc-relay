// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ParameterizedContext } from 'koa';

interface IResponseContext {
  body: {
    jsonrpc: unknown;
    id: unknown;
    result?: unknown;
    error?: { code: unknown; message: unknown };
  };
  status: number | undefined;
}

const VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE = ConfigService.get('VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE');

const FALLBACK_RESPONSE_BODY = {
  jsonrpc: '2.0',
  id: null,
  error: { code: -32600, message: 'Request body is empty; expected a JSON-RPC 2.0 request' },
};

export const INVALID_METHOD_RESPONSE_BODY = {
  ...FALLBACK_RESPONSE_BODY,
  error: { code: -32600, message: 'Invalid HTTP method: only POST is allowed' },
};

const makeSureBodyExistsAndCanBeChecked = (ctx: IResponseContext) => {
  if (ctx.status === 200) return false;

  if (!ctx.body) {
    ctx.status = 400;
    ctx.body = structuredClone(FALLBACK_RESPONSE_BODY);
    return false;
  }

  if (Array.isArray(ctx.body)) {
    ctx.status = 200;
    return false;
  }

  if (typeof ctx.body !== 'object') {
    ctx.status = 400;
    ctx.body = structuredClone(FALLBACK_RESPONSE_BODY);
    return false;
  }
  if (!ctx.body.jsonrpc) ctx.body.jsonrpc = FALLBACK_RESPONSE_BODY.jsonrpc;
  if (!ctx.body.id) ctx.body.id = FALLBACK_RESPONSE_BODY.id;

  return true;
};

/**
 * Ensures a JSON-RPC response uses a valid JSON-RPC 2.0 structure.
 * Normalizes missing or invalid fields for both single and batch responses.
 * May update HTTP status depending on VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE.
 *
 * @param {IResponseContext & ParameterizedContext} ctx - Koa context containing status and body.
 */
export const jsonRpcComplianceLayer = (ctx: IResponseContext & ParameterizedContext) => {
  if (!makeSureBodyExistsAndCanBeChecked(ctx)) return;
  if (ctx.status === 400) {
    if (!ctx.body.error?.code) ctx.body.error = structuredClone(FALLBACK_RESPONSE_BODY.error);
    if ([-32600, -32700].includes(Number(ctx.body.error?.code))) return;
    if (VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE) ctx.status = 200;
  }
};
