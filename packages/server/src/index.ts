// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { setServerTimeout } from './koaJsonRpc/lib/utils';
import { initializeServer, logger } from './server';

async function main() {
  try {
    // Initialize server with the fully initialized Relay
    const { app } = await initializeServer();
    const server = app.listen({ port: ConfigService.get('SERVER_PORT'), host: ConfigService.get('SERVER_HOST') });

    // set request timeout to ensure sockets are closed after specified time of inactivity
    setServerTimeout(server);
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }
}

main();
