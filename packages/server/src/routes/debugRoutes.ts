// SPDX-License-Identifier: Apache-2.0

import { RelayImpl } from '@hashgraph/json-rpc-relay';
import pino from 'pino';

import KoaJsonRpc from '../koaJsonRpc';
import { logAndHandleResponse } from '../utils';

const defineDebugRoutes = function (app: KoaJsonRpc, relay: RelayImpl, logger: pino.Logger) {
  /**
   * Returns all traces of a given transaction.
   *
   * @param hex
   * @param tracer type
   * @returns transaction info
   */
  app.useRpc('debug_traceTransaction', async (params: any) => {
    return logAndHandleResponse(
      'debug_traceTransaction',
      params,
      (requestDetails) => relay.debug().traceTransaction(params, requestDetails),
      app,
      logger,
    );
  });
};

export { defineDebugRoutes };
