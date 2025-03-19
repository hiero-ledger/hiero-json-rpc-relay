// SPDX-License-Identifier: Apache-2.0

import { Relay } from '@hashgraph/json-rpc-relay';
import pino from 'pino';

import KoaJsonRpc from '../koaJsonRpc';
import { logAndHandleResponse } from '../utils';

const defineHederaRoutes = function (app: KoaJsonRpc, relay: Relay, logger: pino.Logger) {
  /**
   * Returns config environment variables
   */
  app.useRpc('hedera_config', async () => {
    return logAndHandleResponse(
      'hedera_config',
      [],
      (requestDetails) => relay.hedera().config(requestDetails),
      app,
      logger,
    );
  });
};

export { defineHederaRoutes };
