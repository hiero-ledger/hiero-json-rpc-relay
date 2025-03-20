// SPDX-License-Identifier: Apache-2.0

import { Relay } from '@hashgraph/json-rpc-relay';
import pino from 'pino';

import KoaJsonRpc from '../koaJsonRpc';
import { logAndHandleResponse } from '../utils';

const defineNetRoutes = function (app: KoaJsonRpc, relay: Relay, logger: pino.Logger) {
  /**
   * Returns true if client is actively listening for network connections.
   *
   * @returns false
   */
  app.useRpc('net_listening', async () => {
    return logAndHandleResponse('net_listening', [], () => '' + relay.net().listening(), app, logger);
  });

  /**
   *  Returns the current network id.
   *
   *  @returns id
   */
  app.useRpc('net_version', async () => {
    return logAndHandleResponse('net_version', [], () => relay.net().version(), app, logger);
  });

  /**
   * Returns the number of peers currently connected to the client.
   *
   * Always returns UNSUPPORTED_METHOD
   */
  app.useRpc('net_peerCount', async () => {
    return logAndHandleResponse('net_peerCount', [], () => relay.net().peerCount(), app, logger);
  });
};

export { defineNetRoutes };
