// SPDX-License-Identifier: Apache-2.0

import { AsyncResource } from 'node:async_hooks';

import Koa from 'koa';
import websockify from 'koa-websocket';
import { type Registry } from 'prom-client';
import type { RedisClientType } from 'redis';
import { v4 as uuid } from 'uuid';

import { ConfigService } from '../config-service/services';
import { createLogger, logContext, runWithLogMethod, setLogMethod } from '../logger';
import { METRICS, MetricsFactory } from '../metrics';
import { predefined } from '../relay';
import { Relay } from '../relay';
import { RedisClientManager } from '../relay/lib/clients/redisClientManager';
import { RegistryFactory } from '../relay/lib/factories/registryFactory';
import { IPRateLimiterService, RateLimitStoreFactory } from '../relay/lib/services';
import { RequestDetails } from '../relay/lib/types';
import { countBatchAddresses, WS_BATCH_ADDRESS_METHODS } from '../relay/lib/utils/addressLimit';
import { type GetLogsMemoryShare, sharedGetLogsMemoryBudget } from '../relay/lib/utils/getLogsMemoryBudget';
import { isRequestAbortedError, requestAbortReason } from '../relay/lib/utils/requestAbort';
import KoaJsonRpc from '../server/koaJsonRpc';
import type { IJsonRpcRequest } from '../server/koaJsonRpc/lib/IJsonRpcRequest';
import { spec } from '../server/koaJsonRpc/lib/RpcError';
import { jsonRespError, jsonRespResult } from '../server/koaJsonRpc/lib/RpcResponse';
import { verifyWsOrigin } from '../server/utils/corsUtils';
import { applyProxyMiddleware } from '../server/utils/proxyUtils';
import { getRequestResult } from './controllers/jsonRpcController';
import ConnectionLimiter from './metrics/connectionLimiter';
import WsMetricRegistry from './metrics/wsMetricRegistry';
import { SubscriptionService } from './service/subscriptionService';
import type { WsContext } from './types';
import { WS_CONSTANTS } from './utils/constants';
import {
  getBatchRequestsMaxSize,
  getWsBatchRequestsEnabled,
  handleConnectionClose,
  isValidJsonRpcId,
  sendToClient,
} from './utils/utils';

const CLIENT_DISCONNECTED_ABORT_REASON = 'The client closed the connection before the response was sent';
const mainLogger = createLogger({
  level: ConfigService.get('LOG_LEVEL'),
  prettyLogsEnabled: ConfigService.get('PRETTY_LOGS_ENABLED'),
});

export const logger = mainLogger.child({ module: 'rpc-ws-server' });
export async function initializeWsServer(
  sharedRelay?: Relay,
  sharedRegister?: Registry,
  redisClient?: RedisClientType,
): Promise<{ app: Koa; httpApp: Koa }> {
  const register = sharedRegister ?? RegistryFactory.getInstance(true);
  const relay = sharedRelay ?? (await Relay.init(logger, register));
  if (!redisClient && !sharedRelay) {
    redisClient = RedisClientManager.isRedisEnabled() ? await RedisClientManager.getClient(logger) : undefined;
  }
  const rateLimitStoreFailureCounter = new MetricsFactory(register).counter(METRICS.rateLimiter.storeFailures);

  // Create rate limit store using factory pattern
  const rateLimitDuration = ConfigService.get('LIMIT_DURATION');
  const rateLimitStore = RateLimitStoreFactory.create(
    logger.child({ module: 'rate-limit-store' }),
    rateLimitDuration,
    rateLimitStoreFailureCounter,
    redisClient,
  );

  const subscriptionService = new SubscriptionService(relay, logger, register);

  const mirrorNodeClient = relay.mirrorClient();

  const rateLimiter = new IPRateLimiterService(rateLimitStore, register);
  const limiter = new ConnectionLimiter(logger, register, rateLimiter);
  const wsMetricRegistry = new WsMetricRegistry(register);

  const pingInterval = ConfigService.get('WS_PING_INTERVAL');

  const inputSizeLimitMb = ConfigService.get('WS_INPUT_SIZE_LIMIT');

  // `ws` currently treats non-positive maxPayload values as unlimited.
  // The configuration sentinel of -1 is normalized to 0 so the runtime
  // value explicitly means "no limit" instead of relying on a negative byte count.
  const maxPayloadBytes = inputSizeLimitMb === -1 ? 0 : inputSizeLimitMb * 1024 * 1024;
  logger.info(
    `Configured WebSocket maxPayload: ${inputSizeLimitMb === -1 ? 'unlimited' : `${maxPayloadBytes} bytes (${inputSizeLimitMb} MB)`}`,
  );

  const app = websockify(new Koa(), { maxPayload: maxPayloadBytes, verifyClient: verifyWsOrigin });

  // Enable proxy support per REAL_IP_ADDRESS_MODE, before anything reads ctx.ip
  applyProxyMiddleware(app, logger);

  // `koa-websocket` hands over a bare socket; these middlewares seed the state `WsContext` describes.
  app.ws.use((koaCtx: Koa.Context, next: Koa.Next) => {
    const ctx = koaCtx as WsContext;
    const connectionId = subscriptionService.generateId();
    ctx.websocket.id = connectionId;
    void next();
  });

  app.ws.use(async (koaCtx: Koa.Context) => {
    const ctx = koaCtx as WsContext;
    // Increment the total opened connections
    wsMetricRegistry.getCounter('totalOpenedConnections').inc();

    // Record the start time when the connection is established
    const startTime = process.hrtime();

    const inFlightRequests = new Set<AbortController>();
    const openMemoryShares = new Set<GetLogsMemoryShare>();
    ctx.websocket.limiter = limiter;
    ctx.websocket.wsMetricRegistry = wsMetricRegistry;

    logger.debug(`New connection established. Current active connections: ${ctx.app.server._connections}`);

    // Close event handle
    // https://nodejs.org/api/async_context.html#static-method-asyncresourcebindfn-type-thisarg
    // https://nodejs.org/api/async_context.html#troubleshooting-context-loss
    ctx.websocket.on(
      'close',
      AsyncResource.bind(async (code: number, message: Buffer) => {
        logger.debug(`Closing connection ${ctx.websocket.id} | code: ${code}, message: ${message}`);

        for (const inFlightRequest of inFlightRequests) {
          inFlightRequest.abort(requestAbortReason(CLIENT_DISCONNECTED_ABORT_REASON));
        }
        inFlightRequests.clear();

        for (const memoryShare of openMemoryShares) {
          memoryShare.close();
        }
        openMemoryShares.clear();

        await handleConnectionClose(ctx, subscriptionService, limiter, wsMetricRegistry, startTime);
      }),
    );

    // Increment limit counters
    limiter.incrementCounters(ctx);

    // Limit checks
    limiter.applyLimits(ctx);

    // listen on message event
    ctx.websocket.on('message', async (msg: Buffer) => {
      const requestId = uuid();
      ctx.websocket.requestId = requestId;

      const abortController = new AbortController();
      inFlightRequests.add(abortController);

      // One share for the whole message, a batch included, closed once its reply has been written to the client.
      const memoryShare = sharedGetLogsMemoryBudget().open();
      openMemoryShares.add(memoryShare);
      const closeMemoryShare = (): void => {
        memoryShare.close();
        openMemoryShares.delete(memoryShare);
      };
      let closeOnWrite = false;

      const requestDetails = new RequestDetails({
        requestId,
        ipAddress: ctx.request.ip,
        connectionId: ctx.websocket.id,
        abortSignal: abortController.signal,
        responseMemoryShare: memoryShare,
      });

      try {
        await logContext.run({ requestId, connectionId: requestDetails.connectionId! }, async () => {
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
            // A message that cannot be decoded is a client error; it may hold a raw transaction, so log it at debug only
            logger.debug(`Could not decode message from connection, message: ${msg}, error: ${e}`);
            ctx.websocket.send(
              JSON.stringify(jsonRespError(null, predefined.INVALID_REQUEST, requestDetails.requestId)),
            );
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
              logger.debug(`${JSON.stringify(batchRequestDisabledError)}`);
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
              logger.debug(`${JSON.stringify(batchRequestAmountMaxExceed)}`);
              ctx.websocket.send(
                JSON.stringify([jsonRespError(null, batchRequestAmountMaxExceed, requestDetails.requestId)]),
              );
              return;
            }

            // reject the whole batch when the caller-supplied address total across all entries exceeds the shared cap
            const maxAddressesPerRequest = ConfigService.get('MAX_ADDRESSES_PER_REQUEST');
            const addressTotal = countBatchAddresses(request, WS_BATCH_ADDRESS_METHODS);
            if (addressTotal > maxAddressesPerRequest) {
              const batchRequestAddressTotalExceed = predefined.WS_BATCH_REQUESTS_ADDRESS_TOTAL_EXCEEDED(
                addressTotal,
                maxAddressesPerRequest,
              );
              logger.debug(`${JSON.stringify(batchRequestAddressTotalExceed)}`);
              ctx.websocket.send(
                JSON.stringify([jsonRespError(null, batchRequestAddressTotalExceed, requestDetails.requestId)]),
              );
              return;
            }

            // process requests
            const requestPromises = request.map((item) => {
              if (item?.id !== undefined && !isValidJsonRpcId(item.id)) {
                return jsonRespError(null, spec.InvalidRequest, requestDetails.requestId);
              }
              if (ConfigService.get('BATCH_REQUESTS_DISALLOWED_METHODS').includes(item.method)) {
                return jsonRespError(
                  isValidJsonRpcId(item.id) ? item.id : null,
                  spec.BatchRequestsMethodNotPermitted(item.method),
                  requestDetails.requestId,
                );
              }
              return runWithLogMethod(item?.method, () =>
                getRequestResult(
                  ctx,
                  relay,
                  logger,
                  item,
                  limiter,
                  mirrorNodeClient,
                  wsMetricRegistry,
                  requestDetails,
                  subscriptionService,
                ),
              );
            });

            // resolve all promises
            const responses = await Promise.all(requestPromises);

            // send to client
            sendToClient(ctx.websocket, request, responses, logger, closeMemoryShare);
            closeOnWrite = true;
          } else {
            if (logger.isLevelEnabled('trace')) {
              logger.trace(`Receive single request=${JSON.stringify(request)}`);
            }

            setLogMethod(request?.method);

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
            sendToClient(ctx.websocket, request, response, logger, closeMemoryShare);
            closeOnWrite = true;
          }

          // Calculate the duration of the connection
          const msgEndTime = process.hrtime(msgStartTime);
          const msgDurationInMiliSeconds = (msgEndTime[0] + msgEndTime[1] / 1e9) * 1000; // Convert duration to miliseconds

          // Update the connection duration histogram, mapping the raw method through the labeler so the
          // metric keeps a bounded set of label values
          const rawMethodLabel = Array.isArray(request) ? WS_CONSTANTS.BATCH_REQUEST_METHOD_NAME : request.method;
          const methodLabel = relay.methodMetricLabeler(rawMethodLabel);
          wsMetricRegistry.getHistogram('messageDuration').labels(methodLabel).observe(msgDurationInMiliSeconds);
        });
      } catch (error) {
        if (!isRequestAbortedError(error)) {
          throw error;
        }

        logger.debug(`Request abandoned by the client: connectionId=%s, requestId=%s`, ctx.websocket.id, requestId);
      } finally {
        inFlightRequests.delete(abortController);

        // Replies handed to the connection close the share once written; every other path closes it here.
        if (!closeOnWrite) {
          closeMemoryShare();
        }
      }
    });

    if (pingInterval > 0) {
      ctx.websocket.pingIntervalId = setInterval(async () => {
        ctx.websocket.send(JSON.stringify(jsonRespResult(null, null)));
      }, pingInterval);
    }
  });

  const koaJsonRpc = new KoaJsonRpc(logger, register, relay, rateLimitStore, undefined);
  const httpApp = koaJsonRpc.getKoaApp();

  httpApp.use(async (ctx: Koa.ParameterizedContext, next: Koa.Next) => {
    // prometheus metrics exposure
    if (ctx.url === '/metrics') {
      ctx.status = 200;
      ctx.body = await register.metrics();
    } else if (ctx.url === '/health/liveness') {
      const redisHealthStatus = await RedisClientManager.isClientHealthy(logger);
      ctx.status = redisHealthStatus ? 200 : 503;
      ctx.body = redisHealthStatus ? 'OK' : 'DOWN';
    } else if (ctx.url === '/health/readiness') {
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
      return await next();
    }
  });

  return { app, httpApp };
}
