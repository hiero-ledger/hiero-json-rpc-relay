// SPDX-License-Identifier: Apache-2.0

import fs from 'fs';
import type Koa from 'koa';
import path from 'path';
import { type Registry } from 'prom-client';
import { type RedisClientType } from 'redis';
import { v4 as uuid } from 'uuid';

import { ConfigService } from '../config-service/services';
import { createLogger, logContext } from '../logger';
import { METRICS, MetricsFactory } from '../metrics';
import { Relay } from '../relay';
import { RedisClientManager } from '../relay/lib/clients/redisClientManager';
import { RegistryFactory } from '../relay/lib/factories/registryFactory';
import { RateLimitStoreFactory } from '../relay/lib/services';
import { formatRequestIdMessage } from './formatters';
import KoaJsonRpc from './koaJsonRpc';
import { HTTP_STATUS } from './koaJsonRpc/lib/httpErrorMapper';
import { spec } from './koaJsonRpc/lib/RpcError';
import { getLimitDuration } from './koaJsonRpc/lib/utils';
import EthereumRPCConformityService from './koaJsonRpc/services/EthereumRPCConformityService';
import { applyCorsMiddleware } from './utils/corsUtils';
import { applyProxyMiddleware } from './utils/proxyUtils';

const mainLogger = createLogger({
  level: ConfigService.get('LOG_LEVEL'),
  prettyLogsEnabled: ConfigService.get('PRETTY_LOGS_ENABLED'),
});

const ethereumRPCConformityService = new EthereumRPCConformityService();

export const logger = mainLogger.child({ module: 'rpc-server' });

/**
 * Initialize the server components
 */
export const register = RegistryFactory.getInstance(true);

export async function initializeServer(
  sharedRelay?: Relay,
  sharedRegister?: Registry,
  redisClient?: RedisClientType,
): Promise<{ app: Koa; relay: Relay }> {
  const register = sharedRegister ?? RegistryFactory.getInstance(true);
  const relay = sharedRelay ?? (await Relay.init(logger.child({ module: 'relay' }), register));
  if (!redisClient && !sharedRelay && RedisClientManager.isRedisEnabled()) {
    redisClient = await RedisClientManager.getClient(logger);
  }
  const metricsFactory = new MetricsFactory(register);
  const rateLimitStoreFailureCounter = metricsFactory.counter(METRICS.rateLimiter.storeFailures);

  // Create rate limit store using factory pattern
  const rateLimitStore = RateLimitStoreFactory.create(
    logger.child({ module: 'rate-limit-store' }),
    getLimitDuration(),
    rateLimitStoreFailureCounter,
    redisClient,
  );

  const koaJsonRpc = new KoaJsonRpc(logger.child({ module: 'koa-rpc' }), register, relay, rateLimitStore, {
    limit: ConfigService.get('INPUT_SIZE_LIMIT') + 'mb',
  });

  const app = koaJsonRpc.getKoaApp();

  const methodResponseHistogram = metricsFactory.histogram(METRICS.server.methodResponse);

  // Enable proxy support per REAL_IP_ADDRESS_MODE, before anything reads ctx.ip
  applyProxyMiddleware(app, logger);

  applyCorsMiddleware(app);

  // Access log and request timing. Every access line is written at DEBUG: the same data is in
  // `rpc_relay_method_response{method, statusCode}` (499 for a client disconnect), and the cause of a failed
  // JSON-RPC call is logged once by the method dispatcher.
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;

    if (ctx.method !== 'POST') {
      logger.debug(`[${ctx.method}]: ${ctx.url} ${ctx.status} ${ms} ms`);
    } else {
      // Since ctx.state.status might contain the request ID from JsonRpcError, remove it for a cleaner log.
      const contextStatus = ctx.state.status?.replace(`[Request ID: ${ctx.state.reqId}] `, '') || ctx.status;

      logger.debug(
        `${formatRequestIdMessage(ctx.state.reqId)} [POST]: ${ctx.state.methodName} ${contextStatus} ${ms} ms`,
      );
      const statusCode = ctx.state.clientDisconnected ? HTTP_STATUS.CLIENT_CLOSED_REQUEST : ctx.status;
      methodResponseHistogram.labels(relay.methodMetricLabeler(ctx.state.methodName), `${statusCode}`).observe(ms);
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

    for (const [key, value] of Object.entries(options)) {
      if (typeof value !== 'boolean' && typeof value !== 'string') {
        throw new Error(`Option \`${key}\` requires a boolean or a string`);
      }
    }

    const requestId = options.query || options.header || uuid();

    if (options.expose) {
      ctx.set(options.expose, requestId);
    }

    ctx.state.reqId = requestId;

    return logContext.run({ requestId }, next);
  });

  const rpcApp = koaJsonRpc.rpcApp();

  app.use(async (ctx) => {
    await rpcApp(ctx);
    ethereumRPCConformityService.ensureEthereumJsonRpcCompliance(ctx);
  });

  return { app, relay };
}
