// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { initializeServer } from '@hashgraph/json-rpc-server/dist/server';

import { initializeWsServer, logger } from './webSocketServer';

async function main() {
  try {
    // Initialize WebSocket server with the fully initialized Relay
    const { app, httpApp } = await initializeWsServer();

    const host = ConfigService.get('SERVER_HOST');
    app.listen({ port: constants.WEB_SOCKET_PORT, host });
    httpApp.listen({ port: constants.WEB_SOCKET_HTTP_PORT, host });

    if (ConfigService.get('SERVER_HTTP_ENABLED')) {
      const { app: rpcServerApp } = await initializeServer();
      rpcServerApp.listen({ port: ConfigService.get('SERVER_PORT'), host });
    }
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }
}

main();
