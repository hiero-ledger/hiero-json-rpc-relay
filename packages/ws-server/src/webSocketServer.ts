// SPDX-License-Identifier: Apache-2.0

import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined } from '@hashgraph/json-rpc-relay/dist';
import { Relay } from '@hashgraph/json-rpc-relay/dist';
import { RedisClientManager } from '@hashgraph/json-rpc-relay/dist/lib/clients/redisClientManager';
import { IPRateLimiterService } from '@hashgraph/json-rpc-relay/dist/lib/services';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import KoaJsonRpc from '@hashgraph/json-rpc-server/dist/koaJsonRpc';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import { spec } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcError';
import { jsonRespError, jsonRespResult } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcResponse';
import Koa from 'koa';
import websockify from 'koa-websocket';
import pino from 'pino';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { v4 as uuid } from 'uuid';

import { getRequestResult } from './controllers/jsonRpcController';
import ConnectionLimiter from './metrics/connectionLimiter';
import WsMetricRegistry from './metrics/wsMetricRegistry';
import { SubscriptionService } from './service/subscriptionService';
import { WS_CONSTANTS } from './utils/constants';
import { getBatchRequestsMaxSize, getWsBatchRequestsEnabled, handleConnectionClose, sendToClient } from './utils/utils';

// https://nodejs.org/api/async_context.html#asynchronous-context-tracking
const context = new AsyncLocalStorage<{ requestId: string; connectionId: string }>();

const mainLogger = pino({
  name: 'hedera-json-rpc-relay',
  level: ConfigService.get('LOG_LEVEL'),
  // https://github.com/pinojs/pino/blob/main/docs/api.md#mixin-function
  mixin: () => {
    const store = context.getStore();
    return store
      ? {
          connectionId: `[Connection ID: ${store.connectionId}] `,
          requestId: `[Request ID: ${store.requestId}] `,
        }
      : {};
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: true,
      messageFormat: '{connectionId}{requestId}{msg}',
      // Ignore one or several keys, nested keys are supported with each property delimited by a dot character (`.`)
      ignore: 'connectionId,requestId',
    },
  },
});

export const logger = mainLogger.child({ name: 'rpc-ws-server' });
export async function initializeWsServer() {
  const register = new Registry();
  const relay = await Relay.init(logger, register);

  const subscriptionService = new SubscriptionService(relay, logger, register);

  const mirrorNodeClient = relay.mirrorClient();

  const rateLimitDuration = ConfigService.get('LIMIT_DURATION');
  const rateLimiter = new IPRateLimiterService(logger.child({ name: 'ip-rate-limit' }), register, rateLimitDuration);
  const limiter = new ConnectionLimiter(logger, register, rateLimiter);
  const wsMetricRegistry = new WsMetricRegistry(register);

  const pingInterval = ConfigService.get('WS_PING_INTERVAL');

  const app = websockify(new Koa());

  app.ws.use((ctx: Koa.Context, next: Koa.Next) => {
    const connectionId = subscriptionService.generateId();
    ctx.websocket.id = connectionId;
    next();
  });

  const isRedisEnabled: boolean = ConfigService.get('REDIS_ENABLED') && !!ConfigService.get('REDIS_URL');
  let redisHealthStatus: boolean = false;
  setInterval(async () => {
    try {
      if (isRedisEnabled) {
        const redisManager = new RedisClientManager(
          logger,
          ConfigService.get('REDIS_URL'),
          ConfigService.get('REDIS_RECONNECT_DELAY_MS'),
        );
        await redisManager.connect();
        await redisManager.getClient().ping();
      }
      redisHealthStatus = true;
    } catch (e) {
      redisHealthStatus = false;
    }
  }, 30_000); // Run every 30 seconds

  app.ws.use(async (ctx: Koa.Context) => {
    // Increment the total opened connections
    wsMetricRegistry.getCounter('totalOpenedConnections').inc();

    // Record the start time when the connection is established
    const startTime = process.hrtime();
    ctx.websocket.limiter = limiter;
    ctx.websocket.wsMetricRegistry = wsMetricRegistry;

    logger.info(
      // @ts-ignore
      `New connection established. Current active connections: ${ctx.app.server._connections}`,
    );

    // Close event handle
    // https://nodejs.org/api/async_context.html#static-method-asyncresourcebindfn-type-thisarg
    // https://nodejs.org/api/async_context.html#troubleshooting-context-loss
    ctx.websocket.on(
      'close',
      AsyncResource.bind(async (code, message) => {
        logger.info(`Closing connection ${ctx.websocket.id} | code: ${code}, message: ${message}`);
        await handleConnectionClose(ctx, subscriptionService, limiter, wsMetricRegistry, startTime);
      }),
    );

    // Increment limit counters
    limiter.incrementCounters(ctx);

    // Limit checks
    limiter.applyLimits(ctx);

    // listen on message event
    ctx.websocket.on('message', async (msg) => {
      const requestId = uuid();
      ctx.websocket.requestId = requestId;

      const requestDetails = new RequestDetails({
        requestId,
        ipAddress: ctx.request.ip,
        connectionId: ctx.websocket.id,
      });

      context.run({ requestId, connectionId: requestDetails.connectionId! }, async () => {
        // Increment the total messages counter for each message received
        wsMetricRegistry.getCounter('totalMessageCounter').inc();

        // Record the start time when a new message is received
        const msgStartTime = process.hrtime();

        // Reset the TTL timer for inactivity upon receiving a message from the client
        limiter.resetInactivityTTLTimer(ctx.websocket);
        // parse the received message from the client into a JSON object
        let request: IJsonRpcRequest | IJsonRpcRequest[];
        try {
          request = JSON.parse(msg.toString('ascii'));
        } catch (e) {
          // Log an error if the message cannot be decoded and send an invalid request error to the client
          logger.warn(`Could not decode message from connection, message: ${msg}, error: ${e}`);
          ctx.websocket.send(JSON.stringify(jsonRespError(null, predefined.INVALID_REQUEST, requestDetails.requestId)));
          return;
        }

        // check if request is a batch request (array) or a signle request (JSON)
        if (Array.isArray(request)) {
          if (logger.isLevelEnabled('trace')) {
            logger.trace(`Receive batch request=${JSON.stringify(request)}`);
          }

          // Increment metrics for batch_requests
          wsMetricRegistry.getCounter('methodsCounter').labels(WS_CONSTANTS.BATCH_REQUEST_METHOD_NAME).inc();
          wsMetricRegistry
            .getCounter('methodsCounterByIp')
            .labels(ctx.request.ip, WS_CONSTANTS.BATCH_REQUEST_METHOD_NAME)
            .inc();

          // send error if batch request feature is not enabled
          if (!getWsBatchRequestsEnabled()) {
            const batchRequestDisabledError = predefined.WS_BATCH_REQUESTS_DISABLED;
            logger.warn(`${JSON.stringify(batchRequestDisabledError)}`);
            ctx.websocket.send(
              JSON.stringify([jsonRespError(null, batchRequestDisabledError, requestDetails.requestId)]),
            );
            return;
          }

          // send error if batch request exceed max batch size
          if (request.length > getBatchRequestsMaxSize()) {
            const batchRequestAmountMaxExceed = predefined.BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(
              request.length,
              getBatchRequestsMaxSize(),
            );
            logger.warn(`${JSON.stringify(batchRequestAmountMaxExceed)}`);
            ctx.websocket.send(
              JSON.stringify([jsonRespError(null, batchRequestAmountMaxExceed, requestDetails.requestId)]),
            );
            return;
          }

          // process requests
          const requestPromises = request.map((item: any) => {
            if (ConfigService.get('BATCH_REQUESTS_DISALLOWED_METHODS').includes(item.method)) {
              return jsonRespError(
                item.id,
                spec.BatchRequestsMethodNotPermitted(item.method),
                requestDetails.requestId,
              );
            }
            return getRequestResult(
              ctx,
              relay,
              logger,
              item,
              limiter,
              mirrorNodeClient,
              wsMetricRegistry,
              requestDetails,
              subscriptionService,
            );
          });

          // resolve all promises
          const responses = await Promise.all(requestPromises);

          // send to client
          sendToClient(ctx.websocket, request, responses, logger);
        } else {
          if (logger.isLevelEnabled('trace')) {
            logger.trace(`Receive single request=${JSON.stringify(request)}`);
          }

          // process requests
          const response = await getRequestResult(
            ctx,
            relay,
            logger,
            request,
            limiter,
            mirrorNodeClient,
            wsMetricRegistry,
            requestDetails,
            subscriptionService,
          );

          // send to client
          sendToClient(ctx.websocket, request, response, logger);
        }

        // Calculate the duration of the connection
        const msgEndTime = process.hrtime(msgStartTime);
        const msgDurationInMiliSeconds = (msgEndTime[0] + msgEndTime[1] / 1e9) * 1000; // Convert duration to miliseconds

        // Update the connection duration histogram with the calculated duration
        const methodLabel = Array.isArray(request) ? WS_CONSTANTS.BATCH_REQUEST_METHOD_NAME : request.method;
        wsMetricRegistry.getHistogram('messageDuration').labels(methodLabel).observe(msgDurationInMiliSeconds);
      });
    });

    if (pingInterval > 0) {
      setInterval(async () => {
        ctx.websocket.send(JSON.stringify(jsonRespResult(null, null)));
      }, pingInterval);
    }
  });

  const koaJsonRpc = new KoaJsonRpc(logger, register, relay);
  const httpApp = koaJsonRpc.getKoaApp();
  collectDefaultMetrics({ register, prefix: 'rpc_relay_' });

  httpApp.use(async (ctx: Koa.Context, next: Koa.Next) => {
    // prometheus metrics exposure
    if (ctx.url === '/metrics') {
      ctx.status = 200;
      ctx.body = await register.metrics();
    } else if (ctx.url === '/health/liveness') {
      if (isRedisEnabled) {
        ctx.status = redisHealthStatus ? 200 : 503;
        ctx.body = redisHealthStatus ? 'OK' : 'DOWN';
      } else {
        ctx.status = 200;
        ctx.body = 'OK';
      }
    } else if (ctx.url === '/health/readiness') {
      try {
        const chainId = relay.eth().chainId();
        const isChainHealthy = chainId !== '0x';

        // redis disabled - only chain health matters
        // redis enabled  - both redis and chain must be healthy
        const healthy = isRedisEnabled ? redisHealthStatus && isChainHealthy : isChainHealthy;

        ctx.status = healthy ? 200 : 503;
        ctx.body = healthy ? 'OK' : 'DOWN';
      } catch (e) {
        logger.error(e);
        throw e;
      }
    } else {
      return await next();
    }
  });

  process.on('unhandledRejection', (reason, p) => {
    logger.error(`Unhandled Rejection at: Promise: ${JSON.stringify(p)}, reason: ${reason}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error(err, 'Uncaught Exception!');
  });

  return { app, httpApp };
}
