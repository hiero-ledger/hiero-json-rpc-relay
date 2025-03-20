// SPDX-License-Identifier: Apache-2.0

import { Relay } from '@hashgraph/json-rpc-relay';
import pino from 'pino';

import KoaJsonRpc from '../koaJsonRpc';
import { logAndHandleResponse } from '../utils';

const defineWeb3Routes = function (app: KoaJsonRpc, relay: Relay, logger: pino.Logger) {
  /**
   * Returns the current version of the chain client.
   *
   * @returns string
   */
  app.useRpc('web3_clientVersion', async () => {
    return logAndHandleResponse('web3_clientVersion', [], () => relay.web3().clientVersion(), app, logger);
  });

  /**
   * Returns the current version of the chain client.
   *
   * @returns string
   */
  app.useRpc('web3_client_version', async () => {
    return logAndHandleResponse('web3_client_version', [], () => relay.web3().clientVersion(), app, logger);
  });

  /**
   * Returns Keccak-256 (not the standardized SHA3-256) hash of the given data.
   *
   * @returns hex
   */
  app.useRpc('web3_sha3', async (params: any) => {
    return logAndHandleResponse('web3_sha3', params, () => relay.web3().sha3(params?.[0]), app, logger);
  });
};

export { defineWeb3Routes };
