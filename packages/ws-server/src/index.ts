// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';

import { initializeWsServer, logger } from './webSocketServer';

async function main() {
  try {
    // Initialize WebSocket server with the fully initialized Relay
    const { app, httpApp } = await initializeWsServer();

    const host = ConfigService.get('SERVER_HOST');
    app.listen({ port: constants.WEB_SOCKET_PORT, host });
    if (httpApp) httpApp.listen({ port: constants.WEB_SOCKET_HTTP_PORT, host });
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }
}

main();
