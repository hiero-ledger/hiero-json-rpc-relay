// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { JsonRpcError, predefined, Relay, RelayImpl } from '@hashgraph/json-rpc-relay/dist';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import KoaJsonRpc from '@hashgraph/json-rpc-server/dist/koaJsonRpc';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import jsonResp from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcResponse';
import Koa from 'koa';
import websockify from 'koa-websocket';
import pino from 'pino';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { v4 as uuid } from 'uuid';

import { getRequestResult } from './controllers';
import ConnectionLimiter from './metrics/connectionLimiter';
import WsMetricRegistry from './metrics/wsMetricRegistry';
import { WS_CONSTANTS } from './utils/constants';
import { getBatchRequestsMaxSize, getWsBatchRequestsEnabled, handleConnectionClose, sendToClient } from './utils/utils';

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
const register = new Registry();
const logger = mainLogger.child({ name: 'rpc-ws-server' });
const relay: Relay = new RelayImpl(logger, register);

const mirrorNodeClient = relay.mirrorClient();
const limiter = new ConnectionLimiter(logger, register);
const wsMetricRegistry = new WsMetricRegistry(register);

const pingInterval = ConfigService.get('WS_PING_INTERVAL');

const app = websockify(new Koa());
app.ws.use(async (ctx: Koa.Context) => {
  // Increment the total opened connections
  wsMetricRegistry.getCounter('totalOpenedConnections').inc();

  // Record the start time when the connection is established
  const startTime = process.hrtime();

  ctx.websocket.id = relay.subs()?.generateId();
  ctx.websocket.requestId = uuid();
  ctx.websocket.limiter = limiter;
  ctx.websocket.wsMetricRegistry = wsMetricRegistry;

  koaJsonRpc.updateRequestDetails({
    requestId: ctx.websocket.requestId,
    ipAddress: ctx.request.ip,
    connectionId: ctx.websocket.id,
  });
  const requestDetails = koaJsonRpc.getRequestDetails();

  logger.info(
    // @ts-ignore
    `${requestDetails.formattedLogPrefix} New connection established. Current active connections: ${ctx.app.server._connections}`,
  );

  // Close event handle
  ctx.websocket.on('close', async (code, message) => {
    logger.info(
      `${requestDetails.formattedLogPrefix} Closing connection ${ctx.websocket.id} | code: ${code}, message: ${message}`,
    );
    await handleConnectionClose(ctx, relay, limiter, wsMetricRegistry, startTime);
  });

  // Increment limit counters
  limiter.incrementCounters(ctx);

  // Limit checks
  limiter.applyLimits(ctx);

  // listen on message event
  ctx.websocket.on('message', async (msg) => {
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
      logger.warn(
        `${requestDetails.formattedLogPrefix}: Could not decode message from connection, message: ${msg}, error: ${e}`,
      );
      ctx.websocket.send(JSON.stringify(new JsonRpcError(predefined.INVALID_REQUEST, undefined)));
      return;
    }

    // check if request is a batch request (array) or a signle request (JSON)
    if (Array.isArray(request)) {
      if (logger.isLevelEnabled('trace')) {
        logger.trace(`${requestDetails.formattedLogPrefix}: Receive batch request=${JSON.stringify(request)}`);
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
        logger.warn(`${requestDetails.formattedLogPrefix}: ${JSON.stringify(batchRequestDisabledError)}`);
        ctx.websocket.send(JSON.stringify([jsonResp(null, batchRequestDisabledError, undefined)]));
        return;
      }

      // send error if batch request exceed max batch size
      if (request.length > getBatchRequestsMaxSize()) {
        const batchRequestAmountMaxExceed = predefined.BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(
          request.length,
          getBatchRequestsMaxSize(),
        );
        logger.warn(`${requestDetails.formattedLogPrefix}: ${JSON.stringify(batchRequestAmountMaxExceed)}`);
        ctx.websocket.send(JSON.stringify([jsonResp(null, batchRequestAmountMaxExceed, undefined)]));
        return;
      }

      // process requests
      const requestPromises = request.map((item: any) => {
        if (ConfigService.get('BATCH_REQUESTS_DISALLOWED_METHODS').includes(item.method)) {
          return jsonResp(item.id, predefined.BATCH_REQUESTS_METHOD_NOT_PERMITTED(item.method), undefined);
        }
        return getRequestResult(ctx, relay, logger, item, limiter, mirrorNodeClient, wsMetricRegistry, requestDetails);
      });

      // resolve all promises
      const responses = await Promise.all(requestPromises);

      // send to client
      sendToClient(ctx.websocket, request, responses, logger, requestDetails);
    } else {
      if (logger.isLevelEnabled('trace')) {
        logger.trace(`${requestDetails.formattedLogPrefix}: Receive single request=${JSON.stringify(request)}`);
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
      );

      // send to client
      sendToClient(ctx.websocket, request, response, logger, requestDetails);
    }

    // Calculate the duration of the connection
    const msgEndTime = process.hrtime(msgStartTime);
    const msgDurationInMiliSeconds = (msgEndTime[0] + msgEndTime[1] / 1e9) * 1000; // Convert duration to miliseconds

    // Update the connection duration histogram with the calculated duration
    const methodLabel = Array.isArray(request) ? WS_CONSTANTS.BATCH_REQUEST_METHOD_NAME : request.method;
    wsMetricRegistry.getHistogram('messageDuration').labels(methodLabel).observe(msgDurationInMiliSeconds);
  });

  if (pingInterval > 0) {
    setInterval(async () => {
      ctx.websocket.send(JSON.stringify(jsonResp(null, null, null)));
    }, pingInterval);
  }
});

const koaJsonRpc = new KoaJsonRpc(logger, register);
const httpApp = koaJsonRpc.getKoaApp();
collectDefaultMetrics({ register, prefix: 'rpc_relay_' });

httpApp.use(async (ctx: Koa.Context, next: Koa.Next) => {
  // prometheus metrics exposure
  if (ctx.url === '/metrics') {
    ctx.status = 200;
    ctx.body = await register.metrics();
  } else if (ctx.url === '/health/liveness') {
    //liveness endpoint
    ctx.status = 200;
  } else if (ctx.url === '/health/readiness') {
    // readiness endpoint
    try {
      const result = relay.eth().chainId(new RequestDetails({ requestId: uuid(), ipAddress: ctx.request.ip }));
      if (result.includes('0x12')) {
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
    return await next();
  }
});

process.on('unhandledRejection', (reason, p) => {
  logger.error(`Unhandled Rejection at: Promise: ${JSON.stringify(p)}, reason: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught Exception!');
});

export { app, httpApp };
