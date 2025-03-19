// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { JsonRpcError, predefined, Relay } from '@hashgraph/json-rpc-relay/dist';
import { IRequestDetails, RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import parse from 'co-body';
import Koa from 'koa';
import { Logger } from 'pino';
import { Histogram, Registry } from 'prom-client';

import RateLimit from '../rateLimit';
import { RpcErrorCodeToStatusMap } from './lib/HttpStatusCodeAndMessage';
import { IJsonRpcRequest } from './lib/IJsonRpcRequest';
import { IJsonRpcResponse } from './lib/IJsonRpcResponse';
import { IMethodRateLimitConfiguration, methodConfiguration } from './lib/methodConfiguration';
import {
  InternalError,
  InvalidRequest,
  IPRateLimitExceeded,
  JsonRpcError as JsonRpcErrorServer,
  ParseError,
} from './lib/RpcError';
import jsonResp from './lib/RpcResponse';
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
  private readonly methodConfig: IMethodRateLimitConfiguration;
  private readonly duration: number = getLimitDuration();
  private readonly defaultRateLimit: number = getDefaultRateLimit();
  private readonly limit: string;
  private readonly rateLimit: RateLimit;
  private readonly metricsRegistry: Registry;
  private readonly koaApp: Koa<Koa.DefaultState, Koa.DefaultContext>;
  private readonly logger: Logger;
  private readonly requestIdIsOptional: boolean = getRequestIdIsOptional(); // default to false
  private readonly batchRequestsMaxSize: number = getBatchRequestsMaxSize(); // default to 100
  private readonly methodResponseHistogram: Histogram;
  private readonly relay: Relay;
  private requestId: string;
  private requestIpAddress: string;
  private connectionId?: string;

  constructor(logger: Logger, register: Registry, relay: Relay, opts?: { limit: string | null }) {
    this.koaApp = new Koa();
    this.requestId = '';
    this.requestIpAddress = '';
    this.methodConfig = methodConfiguration;
    this.limit = opts?.limit ?? '1mb';
    this.logger = logger;
    this.rateLimit = new RateLimit(logger.child({ name: 'ip-rate-limit' }), register, this.duration);
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

  rpcApp(): (ctx: Koa.Context, _next: Koa.Next) => Promise<void> {
    return async (ctx: Koa.Context, _next: Koa.Next) => {
      this.updateRequestDetails({ requestId: ctx.state.reqId, ipAddress: ctx.request.ip });
      ctx.set(REQUEST_ID_HEADER_NAME, this.requestId);

      if (ctx.request.method !== 'POST') {
        ctx.body = jsonResp(null, new InvalidRequest(), undefined);
        ctx.status = 400;
        ctx.state.status = `${ctx.status} (${INVALID_REQUEST})`;
        return;
      }

      let body: IJsonRpcRequest | IJsonRpcRequest[];
      try {
        body = await parse.json(ctx, { limit: this.limit });
      } catch (err) {
        ctx.body = jsonResp(null, new ParseError(), undefined);
        return;
      }
      //check if body is array or object
      if (Array.isArray(body)) {
        await this.handleMultipleRequest(ctx, body);
      } else {
        await this.handleSingleRequest(ctx, body);
      }
    };
  }

  private async handleSingleRequest(ctx: Koa.Context, body: IJsonRpcRequest): Promise<void> {
    ctx.state.methodName = body.method;
    const response = await this.getRequestResult(body, ctx.ip);
    ctx.body = response;
    const errorOrResult = response.error || response.result;

    if (errorOrResult instanceof JsonRpcError || errorOrResult instanceof JsonRpcErrorServer) {
      // What HTTP Status code to return for JsonRpcError
      const httpStatusCodeAndMessage =
        RpcErrorCodeToStatusMap[errorOrResult.code] || RpcErrorCodeToStatusMap['default'];
      ctx.status = httpStatusCodeAndMessage.statusCode;
      ctx.state.status = `${ctx.status} (${httpStatusCodeAndMessage.StatusName})`;
    }
  }

  private async handleMultipleRequest(ctx: Koa.Context, body: any[]): Promise<void> {
    // verify that batch requests are enabled
    if (!getBatchRequestsEnabled()) {
      ctx.body = jsonResp(null, predefined.BATCH_REQUESTS_DISABLED, undefined);
      ctx.status = 400;
      ctx.state.status = `${ctx.status} (${INVALID_REQUEST})`;
      return;
    }

    // verify max batch size
    if (body.length > this.batchRequestsMaxSize) {
      ctx.body = jsonResp(
        null,
        predefined.BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(body.length, this.batchRequestsMaxSize),
        undefined,
      );
      ctx.status = 400;
      ctx.state.status = `${ctx.status} (${INVALID_REQUEST})`;
      return;
    }

    const response: any[] = [];
    ctx.state.methodName = BATCH_REQUEST_METHOD_NAME;

    // we do the requests in parallel to save time, but we need to keep track of the order of the responses (since the id might be optional)
    const promises: Promise<any>[] = body.map(async (item: any) => {
      if (ConfigService.get('BATCH_REQUESTS_DISALLOWED_METHODS').includes(item.method)) {
        return jsonResp(item.id, predefined.BATCH_REQUESTS_METHOD_NOT_PERMITTED(item.method), undefined);
      }
      const startTime = Date.now();
      return this.getRequestResult(item, ctx.ip).then((res) => {
        const ms = Date.now() - startTime;
        this.methodResponseHistogram?.labels(item.method, `${res.error ? res.error.code : 200}`, 'true').observe(ms);
        return res;
      });
    });
    const results = await Promise.all(promises);
    response.push(...results);

    // for batch requests, always return 200 http status, this is standard for JSON-RPC 2.0 batch requests
    ctx.body = response;
    ctx.status = 200;
    ctx.state.status = responseSuccessStatusCode;
  }

  async getRequestResult(request: IJsonRpcRequest, ip: string): Promise<IJsonRpcResponse> {
    try {
      // ensure the request aligns with JSON-RPC 2.0 Specification
      if (!this.validateJsonRpcRequest(request)) {
        return jsonResp(request.id || null, new InvalidRequest(), undefined);
      }

      // check rate limit for method and ip
      const methodTotalLimit = this.methodConfig[request.method]?.total ?? this.defaultRateLimit;
      if (this.rateLimit.shouldRateLimit(ip, request.method, methodTotalLimit, this.requestId)) {
        return jsonResp(request.id, new IPRateLimitExceeded(request.method), undefined);
      }

      // call the public API entry point on the Relay package to execute the RPC method
      const result = await this.relay.executeRpcMethod(request.method, request.params, this.getRequestDetails());

      if (result instanceof JsonRpcError) {
        return jsonResp(request.id, result, undefined);
      } else {
        return jsonResp(request.id, null, result);
      }
    } catch (err: any) {
      return jsonResp(request.id, new InternalError(err.message), undefined);
    }
  }

  validateJsonRpcRequest(body: IJsonRpcRequest): boolean {
    // validate it has the correct jsonrpc version, method, and id
    if (
      body.jsonrpc !== '2.0' ||
      !hasOwnProperty(body, 'method') ||
      this.hasInvalidRequestId(body) ||
      !hasOwnProperty(body, 'id')
    ) {
      this.logger.warn(
        `${this.getFormattedLogPrefix()} Invalid request, body.jsonrpc: ${body.jsonrpc}, body[method]: ${
          body.method
        }, body[id]: ${body.id}, ctx.request.method: ${body.method}`,
      );
      return false;
    }

    return true;
  }

  getKoaApp(): Koa<Koa.DefaultState, Koa.DefaultContext> {
    return this.koaApp;
  }

  getRequestDetails(): RequestDetails {
    return new RequestDetails({
      requestId: this.requestId,
      ipAddress: this.requestIpAddress,
      connectionId: this.connectionId,
    });
  }

  updateRequestDetails(details: IRequestDetails): void {
    this.requestId = details.requestId;
    this.requestIpAddress = details.ipAddress;
    this.connectionId = details.connectionId;
  }

  hasInvalidRequestId(body: IJsonRpcRequest): boolean {
    const hasId = hasOwnProperty(body, 'id');
    if (this.requestIdIsOptional && !hasId) {
      // If the request is invalid, we still want to return a valid JSON-RPC response, default id to 0
      body.id = '0';
      this.logger.warn(
        `${this.getFormattedLogPrefix()} Optional JSON-RPC 2.0 request id encountered. Will continue and default id to 0 in response`,
      );
      return false;
    }

    return !hasId;
  }

  private getFormattedLogPrefix(): string {
    return this.getRequestDetails().formattedLogPrefix;
  }
}
