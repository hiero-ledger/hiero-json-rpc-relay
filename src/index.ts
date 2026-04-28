// SPDX-License-Identifier: Apache-2.0

import pino from 'pino';
import { collectDefaultMetrics } from 'prom-client';

import { ConfigService } from './config-service/services';
import { Relay } from './relay';
import { RedisClientManager } from './relay/lib/clients/redisClientManager';
import constants from './relay/lib/constants';
import { RegistryFactory } from './relay/lib/factories/registryFactory';
import { setServerTimeout } from './server/koaJsonRpc/lib/utils';
import { initializeServer } from './server/server';
import { initializeWsServer } from './ws-server/webSocketServer';

const prettyLogsEnabled = ConfigService.get('PRETTY_LOGS_ENABLED');

const mainLogger = pino({
  name: 'hedera-json-rpc-relay',
  level: ConfigService.get('LOG_LEVEL'),
  ...(prettyLogsEnabled && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: true,
      },
    },
  }),
});

const logger = mainLogger.child({ name: 'main' });

async function main() {
  const rpcHttpEnabled = ConfigService.get('RPC_HTTP_ENABLED');
  const rpcWsEnabled = ConfigService.get('RPC_WS_ENABLED');

  if (!rpcHttpEnabled && !rpcWsEnabled) {
    logger.fatal('At least one transport must be enabled (RPC_HTTP_ENABLED or RPC_WS_ENABLED)');
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  }

  try {
    // Shared initialization (done once)
    const register = RegistryFactory.getInstance(true);
    const relay = await Relay.init(logger.child({ name: 'relay' }), register);
    const redisClient = RedisClientManager.isRedisEnabled() ? await RedisClientManager.getClient(logger) : undefined;

    collectDefaultMetrics({ register, prefix: 'rpc_relay_' });

    const servers: Array<{ stop(): Promise<void> }> = [];

    // Start HTTP transport
    if (rpcHttpEnabled) {
      const { app } = await initializeServer(relay, register, redisClient);
      const server = app.listen({
        port: ConfigService.get('SERVER_PORT'),
        host: ConfigService.get('SERVER_HOST'),
      });
      setServerTimeout(server);
      servers.push({ stop: () => new Promise((resolve) => server.close(() => resolve())) });
      logger.info(`HTTP JSON-RPC server listening on port ${ConfigService.get('SERVER_PORT')}`);
    }

    // Start WebSocket transport
    if (rpcWsEnabled) {
      const { app, httpApp } = await initializeWsServer(relay, register, redisClient);
      const host = ConfigService.get('SERVER_HOST');

      const wsServer = app.listen({ port: constants.WEB_SOCKET_PORT, host });
      servers.push({ stop: () => new Promise((resolve) => wsServer.close(() => resolve())) });
      logger.info(`WebSocket server listening on port ${constants.WEB_SOCKET_PORT}`);

      // WS health/metrics HTTP listener — only needed if HTTP transport is disabled
      if (!rpcHttpEnabled) {
        const wsHttpServer = httpApp.listen({
          port: constants.WEB_SOCKET_HTTP_PORT,
          host,
        });
        servers.push({ stop: () => new Promise((resolve) => wsHttpServer.close(() => resolve())) });
        logger.info(`WS health endpoint on port ${constants.WEB_SOCKET_HTTP_PORT}`);
      }
    }

    // Shared process handlers (registered once, not per-transport)
    process.on('unhandledRejection', (reason, p) => {
      logger.error(`Unhandled Rejection at: Promise: ${JSON.stringify(p)}, reason: ${reason}`);
    });

    process.on('uncaughtException', (err) => {
      logger.error(err, 'Uncaught Exception!');
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await Promise.all(servers.map((s) => s.stop()));
      // eslint-disable-next-line n/no-process-exit
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.fatal(error);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  }
}

main()
  .then(() => logger.info('Relay started successfully'))
  .catch((err) => logger.fatal({ err }, 'Failed to start the relay'));
