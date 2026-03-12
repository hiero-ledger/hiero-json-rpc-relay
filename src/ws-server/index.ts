// SPDX-License-Identifier: Apache-2.0
// Deprecated: Use src/index.ts (unified entrypoint) instead.

import { ConfigService } from '../config-service/services';
import constants from '../relay/lib/constants';
import { initializeWsServer, logger } from './webSocketServer';

async function main() {
  try {
    const { app, httpApp } = await initializeWsServer();

    const host = ConfigService.get('SERVER_HOST');
    app.listen({ port: constants.WEB_SOCKET_PORT, host });
    httpApp.listen({ port: constants.WEB_SOCKET_HTTP_PORT, host });

    process.on('unhandledRejection', (reason, p) => {
      logger.error(`Unhandled Rejection at: Promise: ${JSON.stringify(p)}, reason: ${reason}`);
    });

    process.on('uncaughtException', (err) => {
      logger.error(err, 'Uncaught Exception!');
    });
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }
}

main();
