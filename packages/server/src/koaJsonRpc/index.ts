// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { JsonRpcError, predefined, Relay } from '@hashgraph/json-rpc-relay/dist';
import { methodConfiguration } from '@hashgraph/json-rpc-relay/dist/lib/config/methodConfiguration';
import { IPRateLimiterService } from '@hashgraph/json-rpc-relay/dist/lib/services';
import { MethodRateLimitConfiguration } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import parse from 'co-body';
import Koa from 'koa';
import { Logger } from 'pino';
import { Histogram, Registry } from 'prom-client';

import { translateRpcErrorToHttpStatus } from './lib/httpErrorMapper';
import { IJsonRpcRequest } from './lib/IJsonRpcRequest';
import { spec } from './lib/RpcError';
import { type IJsonRpcResponse, jsonRespError, jsonRespResult } from './lib/RpcResponse';
import {
  getBatchRequestsEnabled,
  getBatchRequestsMaxSize,
  getDefaultRateLimit,
  getLimitDuration,
  getRequestIdIsOptional,
  hasOwnProperty,
} from './lib/utils';

const INVALID_REQUEST = 'INVALID REQUEST';
const REQUEST_ID_HEADER_NAME = 'X-Request-Id';
const responseSuccessStatusCode = '200';
const METRIC_HISTOGRAM_NAME = 'rpc_relay_method_result';
const BATCH_REQUEST_METHOD_NAME = 'batch_request';

export default class KoaJsonRpc {
  private readonly methodConfig: MethodRateLimitConfiguration;
  private readonly duration: number = getLimitDuration();
  private readonly defaultRateLimit: number = getDefaultRateLimit();
  private readonly limit: string;
  private readonly rateLimiter: IPRateLimiterService;
  private readonly metricsRegistry: Registry;
  private readonly koaApp: Koa<Koa.DefaultState, Koa.DefaultContext>;
  private readonly logger: Logger;
  private readonly requestIdIsOptional: boolean = getRequestIdIsOptional(); // default to false
  private readonly batchRequestsMaxSize: number = getBatchRequestsMaxSize(); // default to 100
  private readonly methodResponseHistogram: Histogram;
  private readonly relay: Relay;

  constructor(logger: Logger, register: Registry, relay: Relay, opts?: { limit: string | null }) {
    this.koaApp = new Koa();
    this.methodConfig = methodConfiguration;
    this.limit = opts?.limit ?? '1mb';
    this.logger = logger;
    this.rateLimiter = new IPRateLimiterService(logger.child({ name: 'ip-rate-limit' }), register, this.duration);
    this.metricsRegistry = register;
    this.relay = relay;

    // clear and create metric in registry
    this.metricsRegistry.removeSingleMetric(METRIC_HISTOGRAM_NAME);
    this.methodResponseHistogram = new Histogram({
      name: METRIC_HISTOGRAM_NAME,
      help: 'JSON RPC method statusCode latency histogram',
      labelNames: ['method', 'statusCode', 'isPartOfBatch'],
      registers: [this.metricsRegistry],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000, 30000, 40000, 50000, 60000], // ms (milliseconds)
    });
  }

  rpcApp(): (ctx: Koa.Context) => Promise<void> {
    return async (ctx: Koa.Context) => {
      const requestId = ctx.state.reqId;
      const requestDetails = new RequestDetails({ requestId, ipAddress: ctx.request.ip });
      ctx.set(REQUEST_ID_HEADER_NAME, requestId);

      if (ctx.request.method !== 'POST') {
        ctx.body = jsonRespError(null, spec.InvalidRequest, requestId);
        ctx.status = 400;
        ctx.state.status = `${ctx.status} (${INVALID_REQUEST})`;
        return;
      }

      let body: object | unknown[];
      try {
        body = await parse.json(ctx, { limit: this.limit });
      } catch (err) {
        ctx.body = jsonRespError(null, spec.ParseError, requestId);
        return;
      }
      //check if body is array or object
      if (Array.isArray(body)) {
        await this.handleBatchRequest(ctx, body, requestDetails);
      } else {
        await this.handleSingleRequest(ctx, body, requestDetails);
      }
    };
  }

  private async handleSingleRequest(ctx: Koa.Context, body: object, requestDetails: RequestDetails): Promise<void> {
    const response = !this.hasValidJsonRpcId(body)
      ? jsonRespError(null, spec.InvalidRequest, requestDetails.requestId)
      : !this.isValidJsonRpcRequest(body)
        ? jsonRespError(body.id, spec.InvalidRequest, requestDetails.requestId)
        : await this.getRequestResult(body, ctx.ip, requestDetails);

    ctx.body = response;
    ctx.state.methodName = body['method'];

    if ('error' in response) {
      const { statusErrorCode, statusErrorMessage } = translateRpcErrorToHttpStatus(response.error);

      ctx.status = statusErrorCode;
      ctx.state.status = `${ctx.status} (${statusErrorMessage})`;
    }
  }

  private async handleBatchRequest(ctx: Koa.Context, body: unknown[], requestDetails: RequestDetails): Promise<void> {
    // verify that batch requests are enabled
    if (!getBatchRequestsEnabled()) {
      ctx.body = jsonRespError(null, predefined.BATCH_REQUESTS_DISABLED, requestDetails.requestId);
      ctx.status = 400;
      ctx.state.status = `${ctx.status} (${INVALID_REQUEST})`;
      return;
    }

    // verify max batch size
    if (body.length > this.batchRequestsMaxSize) {
      ctx.body = jsonRespError(
        null,
        predefined.BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(body.length, this.batchRequestsMaxSize),
        requestDetails.requestId,
      );
      ctx.status = 400;
      ctx.state.status = `${ctx.status} (${INVALID_REQUEST})`;
      return;
    }

    ctx.state.methodName = BATCH_REQUEST_METHOD_NAME;

    // we do the requests in parallel to save time, but we need to keep track of the order of the responses (since the id might be optional)
    const promises: Promise<IJsonRpcResponse>[] = body.map(async (item) => {
      if (!this.hasValidJsonRpcId(item)) return jsonRespError(null, spec.InvalidRequest, requestDetails.requestId);

      if (!this.isValidJsonRpcRequest(item))
        return jsonRespError(item.id || null, spec.InvalidRequest, requestDetails.requestId);

      if (ConfigService.get('BATCH_REQUESTS_DISALLOWED_METHODS').includes(item.method))
        return jsonRespError(item.id, spec.BatchRequestsMethodNotPermitted(item.method), requestDetails.requestId);

      const startTime = Date.now();
      return this.getRequestResult(item, ctx.ip, requestDetails).then((res) => {
        const ms = Date.now() - startTime;
        const code = 'error' in res ? res.error.code : 200;
        this.methodResponseHistogram?.labels(item.method, `${code}`, 'true').observe(ms);
        return res;
      });
    });
    const results = await Promise.all(promises);
    // const response: any[] = [];
    // response.push(...results);

    // for batch requests, always return 200 http status, this is standard for JSON-RPC 2.0 batch requests
    ctx.body = results;
    ctx.status = 200;
    ctx.state.status = responseSuccessStatusCode;
  }

  async getRequestResult(
    request: IJsonRpcRequest,
    ip: string,
    requestDetails: RequestDetails,
  ): Promise<IJsonRpcResponse> {
    try {
      // check rate limit for method and ip
      const methodTotalLimit = this.methodConfig[request.method]?.total ?? this.defaultRateLimit;
      if (await this.rateLimiter.shouldRateLimit(ip, request.method, methodTotalLimit, requestDetails)) {
        return jsonRespError(request.id, spec.IPRateLimitExceeded(request.method), requestDetails.requestId);
      }

      // call the public API entry point on the Relay package to execute the RPC method
      const result = await this.relay.executeRpcMethod(request.method, request.params, requestDetails);

      if (result instanceof JsonRpcError) {
        return jsonRespError(request.id, result, requestDetails.requestId);
      } else {
        return jsonRespResult(request.id, result);
      }
    } catch (err) {
      /* istanbul ignore next: this catch block covers programmatic errors and should not happen */
      return jsonRespError(request.id, spec.InternalError(err), requestDetails.requestId);
    }
  }

  isValidJsonRpcRequest(body: Pick<IJsonRpcRequest, 'id'>): body is IJsonRpcRequest {
    // validate it has the correct jsonrpc version, method, and id
    if (
      body['jsonrpc'] === '2.0' &&
      hasOwnProperty(body, 'method')
      // this.hasValidJsonRpcId(body) &&
      // hasOwnProperty(body, 'id')
    ) {
      return true;
    }

    // this.logger.warn(
    //   `Invalid request, body.jsonrpc: ${body.jsonrpc}, body[method]: ${body.method}, body[id]: ${body.id}, ctx.request.method: ${body.method}`,
    // );
    return false;
  }

  getKoaApp(): Koa<Koa.DefaultState, Koa.DefaultContext> {
    return this.koaApp;
  }

  hasValidJsonRpcId(body: unknown): body is Pick<IJsonRpcRequest, 'id'> {
    const hasId = hasOwnProperty(body, 'id');
    if (hasId) return true;
    if (this.requestIdIsOptional && typeof body === 'object' && body !== null) {
      // If the request is invalid, we still want to return a valid JSON-RPC response, default id to 0
      body['id'] = '0';
      this.logger.warn(`Optional JSON-RPC 2.0 request id encountered. Will continue and default id to 0 in response`);
      return true;
    }
    return false;
  }
}
