// SPDX-License-Identifier: Apache-2.0

import { AsyncLocalStorage } from 'node:async_hooks';

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Relay } from '@hashgraph/json-rpc-relay/dist';
import { RedisClientManager } from '@hashgraph/json-rpc-relay/dist/lib/clients/redisClientManager';
import { RegistryFactory } from '@hashgraph/json-rpc-relay/dist/lib/factories/registryFactory';
import { RateLimitStoreFactory } from '@hashgraph/json-rpc-relay/dist/lib/services';
import cors from '@koa/cors';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { collectDefaultMetrics, Counter, Histogram } from 'prom-client';
import { v4 as uuid } from 'uuid';

import { formatRequestIdMessage } from './formatters';
import KoaJsonRpc from './koaJsonRpc';
import { spec } from './koaJsonRpc/lib/RpcError';
import { getLimitDuration } from './koaJsonRpc/lib/utils';
import {
  EthereumRPCConformityService,
  INVALID_METHOD_RESPONSE_BODY,
} from './koaJsonRpc/services/EthereumRPCConformityService';

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

export const logger = mainLogger.child({ name: 'rpc-server' });
export const register = RegistryFactory.getInstance(true);

/**
 * Parse RFC 7239 Forwarded header to extract the original client IP
 *
 * This function safely parses the Forwarded header without using regex to avoid
 * ReDoS (Regular Expression Denial of Service) vulnerabilities. It includes
 * input length limits and basic validation to prevent malicious input from
 * causing performance issues.
 *
 * @param forwardedHeader - The Forwarded header value
 * @returns The client IP address or null if not found
 */
function parseForwardedHeader(forwardedHeader: string): string | null {
  try {
    // Limit input length to prevent DoS attacks
    if (forwardedHeader.length > 1000) {
      return null;
    }

    // Split by comma to handle multiple forwarded entries
    const entries = forwardedHeader.split(',');

    // Take the first entry (original client)
    const firstEntry = entries[0]?.trim();
    if (!firstEntry) return null;

    // Find the 'for=' parameter using safe string parsing
    const forIndex = firstEntry.toLowerCase().indexOf('for=');
    if (forIndex === -1) return null;

    // Extract the value after 'for='
    const valueStart = forIndex + 4; // Length of 'for='
    if (valueStart >= firstEntry.length) return null;

    let ip: string;
    const char = firstEntry[valueStart];

    if (char === '"') {
      // Quoted value: for="192.168.1.1" or for="[2001:db8::1]"
      const closeQuoteIndex = firstEntry.indexOf('"', valueStart + 1);
      if (closeQuoteIndex === -1) return null;
      ip = firstEntry.substring(valueStart + 1, closeQuoteIndex);

      // Handle IPv6 in brackets within quotes: for="[2001:db8::1]"
      if (ip.startsWith('[') && ip.endsWith(']')) {
        ip = ip.substring(1, ip.length - 1);
      }
    } else if (char === '[') {
      // IPv6 in brackets: for=[2001:db8::1]
      const closeBracketIndex = firstEntry.indexOf(']', valueStart + 1);
      if (closeBracketIndex === -1) return null;
      ip = firstEntry.substring(valueStart + 1, closeBracketIndex);
    } else {
      // Unquoted value: for=192.168.1.1
      let endIndex = valueStart;
      while (endIndex < firstEntry.length) {
        const c = firstEntry[endIndex];
        if (c === ';' || c === ',' || c === ' ' || c === '\t') {
          break;
        }
        endIndex++;
      }
      ip = firstEntry.substring(valueStart, endIndex);
    }

    // Basic validation: ensure we have a non-empty result
    if (!ip || ip.length === 0 || ip.length > 45) {
      // Max IPv6 length is 45 chars
      return null;
    }

    // Basic IP format validation (very permissive)
    if (!/^[a-fA-F0-9:.]+$/.test(ip)) {
      return null;
    }

    return ip;
  } catch {
    // If parsing fails, return null to avoid breaking the request
    return null;
  }
}

/**
 * Initialize the server components
 */
export async function initializeServer() {
  const relay = await Relay.init(logger.child({ name: 'relay' }), register);

  // Get Redis client if Redis is enabled
  const redisClient = RedisClientManager.isRedisEnabled() ? await RedisClientManager.getClient(logger) : undefined;

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

  collectDefaultMetrics({ register, prefix: 'rpc_relay_' });

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

  // enable proxy support to trust proxy-added headers for client IP detection
  app.proxy = true;

  // Middleware to parse RFC 7239 Forwarded header and make it compatible with Koa's X-Forwarded-For parsing
  app.use(async (ctx, next) => {
    // Only process if X-Forwarded-For doesn't exist but Forwarded does
    if (!ctx.request.headers['x-forwarded-for'] && ctx.request.headers['forwarded']) {
      const forwardedHeader = ctx.request.headers['forwarded'] as string;

      // Parse the Forwarded header to extract the client IP
      // Format: Forwarded: for="192.168.1.1";by="10.0.0.1", for="203.0.113.1";by="10.0.0.2"
      const clientIp = parseForwardedHeader(forwardedHeader);

      if (clientIp) {
        // Set X-Forwarded-For so Koa can parse it normally
        ctx.request.headers['x-forwarded-for'] = clientIp;
      }
    }

    await next();
  });

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
        JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/openrpc.json')).toString()),
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
      ctx.body = structuredClone(INVALID_METHOD_RESPONSE_BODY);
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
    EthereumRPCConformityService.ensureEthereumJsonRpcCompliance(ctx);
  });

  process.on('unhandledRejection', (reason, p) => {
    logger.error(`Unhandled Rejection at: Promise: ${JSON.stringify(p)}, reason: ${reason}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error(err, 'Uncaught Exception!');
  });

  return { app };
}
