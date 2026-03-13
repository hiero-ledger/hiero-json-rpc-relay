// SPDX-License-Identifier: Apache-2.0
// Deprecated: Use src/index.ts (unified entrypoint) instead.

import { ConfigService } from '../config-service/services';
import { setServerTimeout } from './koaJsonRpc/lib/utils';
import { initializeServer, logger } from './server';

async function main() {
  try {
    const { app } = await initializeServer();
    const server = app.listen({ port: ConfigService.get('SERVER_PORT'), host: ConfigService.get('SERVER_HOST') });

    setServerTimeout(server);

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
