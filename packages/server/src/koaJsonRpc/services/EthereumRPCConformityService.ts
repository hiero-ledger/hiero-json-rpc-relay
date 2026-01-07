// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ParameterizedContext } from 'koa';

/**
 * Minimal shape of a JSON-RPC 2.0 response object used by this middleware.
 *
 * Note: this service intentionally keeps fields typed as `unknown` because it
 * operates as a conformity/normalization layer, not as a validator.
 */
interface IResponseContext {
  body: {
    jsonrpc: unknown;
    id: unknown;
    result?: unknown;
    error?: { code: unknown; message: unknown };
  };
  status: number | undefined;
}

/**
 * This service is response for adjusting the Koa responses to better match JSON-RPC 2.0
 * expectations for Ethereum.
 */
export default class EthereumRPCConformityService {
  /**
   * Static response body for invalid HTTP method scenarios.
   */
  static readonly INVALID_METHOD_RESPONSE_BODY = {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Invalid HTTP method: only POST is allowed' },
  };

  /**
   * Fallback response body used when current one is malformed.
   */
  private readonly fallbackResponseBody = {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Request body is empty; expected a JSON-RPC 2.0 request' },
  };

  /**
   * If a JSON-RPC request payload has valid format, response will have this status code.
   */
  private readonly onValidJsonRpcHttpResponseStatusCode: number;

  public constructor() {
    this.onValidJsonRpcHttpResponseStatusCode = ConfigService.get('ON_VALID_JSON_RPC_HTTP_RESPONSE_STATUS_CODE');
  }

  /**
   * Ensures a JSON-RPC response uses a valid JSON-RPC 2.0 structure.
   * Normalizes missing or invalid fields for both single and batch responses.
   * May update HTTP status depending on ON_VALID_JSON_RPC_HTTP_RESPONSE_STATUS_CODE value.
   *
   * @param {IResponseContext & ParameterizedContext} ctx - Koa context containing status and body.
   */
  ensureEthereumJsonRpcCompliance(ctx: IResponseContext & ParameterizedContext) {
    if (!this.makeSureBodyExistsAndCanBeChecked(ctx)) return;
    if (ctx.status === 400) {
      if (!ctx.body.error?.code) ctx.body.error = structuredClone(this.fallbackResponseBody.error);
      if ([-32600, -32700].includes(Number(ctx.body.error?.code))) return;
      ctx.status = this.onValidJsonRpcHttpResponseStatusCode;
    }
  }

  /**
   * Makes sure the context body is present and has an interface that can be inspected and normalized.
   * *
   * @param {IResponseContext} ctx
   * @private
   */
  private makeSureBodyExistsAndCanBeChecked(ctx: IResponseContext) {
    if (ctx.status === 200) return false;

    if (!ctx.body) {
      ctx.status = 400;
      ctx.body = structuredClone(this.fallbackResponseBody);
      return false;
    }

    if (Array.isArray(ctx.body)) {
      ctx.status = 200;
      return false;
    }

    if (typeof ctx.body !== 'object') {
      ctx.status = 400;
      ctx.body = structuredClone(this.fallbackResponseBody);
      return false;
    }
    if (!ctx.body.jsonrpc) ctx.body.jsonrpc = this.fallbackResponseBody.jsonrpc;
    if (!ctx.body.id) ctx.body.id = this.fallbackResponseBody.id;

    return true;
  }
}
