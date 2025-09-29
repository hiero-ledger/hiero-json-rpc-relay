// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';

import { app, httpApp, logger, relay } from './webSocketServer';

async function main() {
  try {
    await relay.init();
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }

  const host = ConfigService.get('SERVER_HOST');
  app.listen({ port: constants.WEB_SOCKET_PORT, host });
  httpApp.listen({ port: constants.WEB_SOCKET_HTTP_PORT, host });
}

main();
