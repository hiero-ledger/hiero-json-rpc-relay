// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined, RelayImpl } from '@hashgraph/json-rpc-relay/dist';
import fs from 'fs';
import cors from 'koa-cors';
import path from 'path';
import pino from 'pino';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';
import { v4 as uuid } from 'uuid';

import { formatRequestIdMessage } from './formatters';
import KoaJsonRpc from './koaJsonRpc';
import { defineDebugRoutes } from './routes/debugRoutes';
import { defineEthRoutes } from './routes/ethRoutes';
import { logAndHandleResponse } from './utils';

const mainLogger = pino({
  name: 'hedera-json-rpc-relay',
  // Pino requires the default level to be explicitly set; without fallback value ("trace"), an invalid or missing value could trigger the "default level must be included in custom levels" error.
  level: ConfigService.get('LOG_LEVEL') || 'trace',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: true,
    },
  },
});

const logger = mainLogger.child({ name: 'rpc-server' });
const register = new Registry();
const relay = new RelayImpl(logger.child({ name: 'relay' }), register);
const app = new KoaJsonRpc(logger.child({ name: 'koa-rpc' }), register, {
  limit: ConfigService.get('INPUT_SIZE_LIMIT') + 'mb',
});

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

// set cors
app.getKoaApp().use(cors());

/**
 * middleware for non POST request timing
 */
app.getKoaApp().use(async (ctx, next) => {
  const start = Date.now();
  ctx.state.start = start;
  await next();

  const ms = Date.now() - start;
  if (ctx.method !== 'POST') {
    logger.info(`[${ctx.method}]: ${ctx.url} ${ctx.status} ${ms} ms`);
  } else {
    // log call type, method, status code and latency
    logger.info(
      `${formatRequestIdMessage(ctx.state.reqId)} [${ctx.method}]: ${ctx.state.methodName} ${ctx.status} ${ms} ms`,
    );
    methodResponseHistogram.labels(ctx.state.methodName, `${ctx.status}`).observe(ms);
  }
});

/**
 * prometheus metrics exposure
 */
app.getKoaApp().use(async (ctx, next) => {
  if (ctx.url === '/metrics') {
    ctx.status = 200;
    ctx.body = await register.metrics();
  } else {
    return next();
  }
});

/**
 * liveness endpoint
 */
app.getKoaApp().use(async (ctx, next) => {
  if (ctx.url === '/health/liveness') {
    ctx.status = 200;
  } else {
    return next();
  }
});

/**
 * readiness endpoint
 */
app.getKoaApp().use(async (ctx, next) => {
  if (ctx.url === '/health/readiness') {
    try {
      const result = relay.eth().chainId(app.getRequestDetails());
      if (result.indexOf('0x12') >= 0) {
        ctx.status = 200;
        ctx.body = 'OK';
      } else {
        ctx.body = 'DOWN';
        ctx.status = 503; // UNAVAILABLE
      }
    } catch (e) {
      logger.error(e);
      throw e;
    }
  } else {
    return next();
  }
});

/**
 * openrpc endpoint
 */
app.getKoaApp().use(async (ctx, next) => {
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

/**
 * middleware to end for non POST requests asides health, metrics and openrpc
 */
app.getKoaApp().use(async (ctx, next) => {
  if (ctx.method === 'POST') {
    await next();
  } else if (ctx.method === 'OPTIONS') {
    // support CORS preflight
    ctx.status = 200;
  } else {
    logger.warn(`skipping HTTP method: [${ctx.method}], url: ${ctx.url}, status: ${ctx.status}`);
  }
});

app.getKoaApp().use(async (ctx, next) => {
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

  let id = '';

  if (options.query) {
    id = options.query as string;
  }

  if (!id && options.header) {
    id = options.header;
  }

  if (!id) {
    id = uuid();
  }

  if (options.expose) {
    ctx.set(options.expose, id);
  }

  ctx.state.reqId = id;

  return next();
});

defineDebugRoutes(app, relay, logger);
defineEthRoutes(app, relay, logger);

for (const methodName of Object.keys(relay.methods)) {
  logger.debug('Setting up RPC handler for method %s', methodName);
  app.useRpc(methodName, async (params: any) => {
    return logAndHandleResponse(
      methodName,
      params,
      (requestDetails) => relay.dispatch(methodName, params, requestDetails),
      app,
      logger,
    );
  });
}

app.useRpcRegex(/^engine_.*$/, async () => {
  return logAndHandleResponse('engine', [], () => predefined.UNSUPPORTED_METHOD, app, logger);
});
app.useRpcRegex(/^trace_.*$/, async () => {
  return logAndHandleResponse('trace', [], () => predefined.NOT_YET_IMPLEMENTED, app, logger);
});
app.useRpcRegex(/^debug_.*$/, async () => {
  return logAndHandleResponse('debug', [], () => predefined.NOT_YET_IMPLEMENTED, app, logger);
});

const rpcApp = app.rpcApp();

app.getKoaApp().use(async (ctx, next) => {
  await rpcApp(ctx, next);
});

process.on('unhandledRejection', (reason, p) => {
  logger.error(`Unhandled Rejection at: Promise: ${JSON.stringify(p)}, reason: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught Exception!');
});

export default app.getKoaApp();
