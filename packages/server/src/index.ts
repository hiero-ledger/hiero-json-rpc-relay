// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { setServerTimeout } from './koaJsonRpc/lib/utils'; // Import the 'setServerTimeout' function from the correct location
import app, { logger, relay } from './server';

async function main() {
  try {
    await relay.ensureOperatorHasBalance();
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }

  const server = app.listen({ port: ConfigService.get('SERVER_PORT'), host: ConfigService.get('SERVER_HOST') });

  // set request timeout to ensure sockets are closed after specified time of inactivity
  setServerTimeout(server);

  // Handle graceful shutdown for monitoring tools
  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });

    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
      logger.warn('Force exiting after timeout...');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main();
