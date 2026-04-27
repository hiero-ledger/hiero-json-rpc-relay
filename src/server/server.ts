// SPDX-License-Identifier: Apache-2.0

import { AsyncLocalStorage } from 'node:async_hooks';

import cors from '@koa/cors';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { Counter, Histogram, Registry } from 'prom-client';
import { RedisClientType } from 'redis';
import { v4 as uuid } from 'uuid';

import { ConfigService } from '../config-service/services';
import { Relay } from '../relay';
import { RedisClientManager } from '../relay/lib/clients/redisClientManager';
import { RegistryFactory } from '../relay/lib/factories/registryFactory';
import { RateLimitStoreFactory } from '../relay/lib/services';
import { formatRequestIdMessage } from './formatters';
import KoaJsonRpc from './koaJsonRpc';
import { spec } from './koaJsonRpc/lib/RpcError';
import { getLimitDuration } from './koaJsonRpc/lib/utils';
import EthereumRPCConformityService from './koaJsonRpc/services/EthereumRPCConformityService';
import { applyProxyMiddleware } from './utils/proxyUtils';

// https://nodejs.org/api/async_context.html#asynchronous-context-tracking
const context = new AsyncLocalStorage<{ requestId: string }>();

const prettyLogsEnabled = ConfigService.get('PRETTY_LOGS_ENABLED');

const mainLogger = pino({
  name: 'hedera-json-rpc-relay',
  level: ConfigService.get('LOG_LEVEL'),
  // https://github.com/pinojs/pino/blob/main/docs/api.md#mixin-function
  mixin: () => {
    const store = context.getStore();
    return store ? { requestId: `[Request ID: ${store.requestId}] ` } : {};
  },
  // Use pino-pretty when PRETTY_LOGS_ENABLED is true (default), otherwise use JSON format
  ...(prettyLogsEnabled && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: true,
        messageFormat: '{requestId}{msg}',
        // Ignore one or several keys, nested keys are supported with each property delimited by a dot character (`.`)
        ignore: 'requestId',
      },
    },
  }),
});

const ethereumRPCConformityService = new EthereumRPCConformityService();

export const logger = mainLogger.child({ name: 'rpc-server' });

/**
 * Initialize the server components
 */
export const register = RegistryFactory.getInstance(true);

export async function initializeServer(sharedRelay?: Relay, sharedRegister?: Registry, redisClient?: RedisClientType) {
  const register = sharedRegister ?? RegistryFactory.getInstance(true);
  const relay = sharedRelay ?? (await Relay.init(logger.child({ name: 'relay' }), register));
  if (!redisClient && !sharedRelay && RedisClientManager.isRedisEnabled()) {
    redisClient = await RedisClientManager.getClient(logger);
  }
  // Initialize rate limit store failure counter
  const storeFailureMetricName = 'rpc_relay_rate_limit_store_failures';
  if (register.getSingleMetric(storeFailureMetricName)) {
    register.removeSingleMetric(storeFailureMetricName);
  }
  const rateLimitStoreFailureCounter = new Counter({
    name: storeFailureMetricName,
    help: 'Rate limit store failure counter',
    labelNames: ['storeType', 'operation'],
    registers: [register],
  });

  // Create rate limit store using factory pattern
  const rateLimitStore = RateLimitStoreFactory.create(
    logger.child({ name: 'rate-limit-store' }),
    getLimitDuration(),
    rateLimitStoreFailureCounter,
    redisClient,
  );

  const koaJsonRpc = new KoaJsonRpc(logger.child({ name: 'koa-rpc' }), register, relay, rateLimitStore, {
    limit: ConfigService.get('INPUT_SIZE_LIMIT') + 'mb',
  });

  const app = koaJsonRpc.getKoaApp();

  // clear and create metric in registry
  const metricHistogramName = 'rpc_relay_method_response';
  register.removeSingleMetric(metricHistogramName);
  const methodResponseHistogram = new Histogram({
    name: metricHistogramName,
    help: 'JSON RPC method statusCode latency histogram',
    labelNames: ['method', 'statusCode'],
    registers: [register],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000, 30000, 40000, 50000, 60000], // ms (milliseconds)
  });

  // Enable proxy support and RFC 7239 Forwarded header translation
  applyProxyMiddleware(app);

  // Set CORS
  app.use(cors({ allowMethods: ['GET', 'POST'] }));

  // Middleware for non POST request timing
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;

    if (ctx.method !== 'POST') {
      logger.info(`[${ctx.method}]: ${ctx.url} ${ctx.status} ${ms} ms`);
    } else {
      // Since ctx.state.status might contain the request ID from JsonRpcError, remove it for a cleaner log.
      const contextStatus = ctx.state.status?.replace(`[Request ID: ${ctx.state.reqId}] `, '') || ctx.status;

      // log call type, method, status code and latency
      logger.info(
        `${formatRequestIdMessage(ctx.state.reqId)} [POST]: ${ctx.state.methodName} ${contextStatus} ${ms} ms`,
      );
      methodResponseHistogram.labels(ctx.state.methodName, `${ctx.status}`).observe(ms);
    }
  });

  // Liveness endpoint
  app.use(async (ctx, next) => {
    if (ctx.url === '/health/liveness') {
      const redisHealthStatus = await RedisClientManager.isClientHealthy(logger);
      ctx.status = redisHealthStatus ? 200 : 503;
      ctx.body = redisHealthStatus ? 'OK' : 'DOWN';
    } else {
      return next();
    }
  });

  // Readiness endpoint
  app.use(async (ctx, next) => {
    if (ctx.url === '/health/readiness') {
      try {
        const chainId = relay.eth().chainId();
        const isChainHealthy = chainId !== '0x';

        // redis disabled - only chain health matters
        // redis enabled  - both redis and chain must be healthy
        const isHealthy: boolean = (await RedisClientManager.isClientHealthy(logger)) && isChainHealthy;

        ctx.status = isHealthy ? 200 : 503;
        ctx.body = isHealthy ? 'OK' : 'DOWN';
      } catch (e) {
        logger.error(e);
        throw e;
      }
    } else {
      return next();
    }
  });

  // Prometheus metrics exposure
  app.use(async (ctx, next) => {
    if (ctx.url === '/metrics') {
      ctx.status = 200;
      ctx.body = await register.metrics();
    } else {
      return next();
    }
  });

  // Config endpoint
  app.use(async (ctx, next) => {
    if (ctx.url === '/config') {
      if (ConfigService.get('DISABLE_ADMIN_NAMESPACE')) {
        return spec.MethodNotFound('config');
      }
      ctx.status = 200;
      ctx.body = JSON.stringify(await relay.admin().config());
    } else {
      return next();
    }
  });

  // OpenRPC endpoint
  app.use(async (ctx, next) => {
    if (ctx.url === '/openrpc') {
      ctx.status = 200;
      ctx.body = JSON.stringify(
        JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/openrpc.json')).toString()),
        null,
        2,
      );
    } else {
      return next();
    }
  });

  // Middleware to end for non POST requests asides health, metrics and openrpc
  app.use(async (ctx, next) => {
    if (ctx.method === 'POST') {
      await next();
    } else if (ctx.method === 'OPTIONS') {
      // support CORS preflight
      ctx.status = 200;
    } else {
      ctx.status = 405;
      ctx.body = EthereumRPCConformityService.INVALID_METHOD_RESPONSE_BODY;
    }
  });

  app.use((ctx, next) => {
    const options = {
      expose: ctx.get('Request-Id'),
      header: ctx.get('Request-Id'),
      query: ctx.get('query'),
    };

    for (const key in options) {
      if (typeof options[key] !== 'boolean' && typeof options[key] !== 'string') {
        throw new Error(`Option \`${key}\` requires a boolean or a string`);
      }
    }

    const requestId = options.query || options.header || uuid();

    if (options.expose) {
      ctx.set(options.expose, requestId);
    }

    ctx.state.reqId = requestId;

    return context.run({ requestId }, next);
  });

  const rpcApp = koaJsonRpc.rpcApp();

  app.use(async (ctx) => {
    await rpcApp(ctx);
    ethereumRPCConformityService.ensureEthereumJsonRpcCompliance(ctx);
  });

  return { app, relay };
}
