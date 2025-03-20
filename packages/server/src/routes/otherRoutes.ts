// SPDX-License-Identifier: Apache-2.0

import { predefined, Relay } from '@hashgraph/json-rpc-relay';
import pino from 'pino';

import KoaJsonRpc from '../koaJsonRpc';
import { logAndHandleResponse } from '../utils';

// Handle engine_*, trace_*, debug_* methods
// Since we have a catch-all for all trace/engine/debug methods that returns UNSUPPORTED, polluting the
// project with 3 separate files seems unnecessary. If we decide to implement some of them in the future, we can then create
// a separate file.
const defineOtherRoutes = function (app: KoaJsonRpc, relay: Relay, logger: pino.Logger) {
  app.useRpcRegex(/^engine_.*$/, async () => {
    return logAndHandleResponse('engine', [], () => predefined.UNSUPPORTED_METHOD, app, logger);
  });

  app.useRpcRegex(/^trace_.*$/, async () => {
    return logAndHandleResponse('trace', [], () => predefined.NOT_YET_IMPLEMENTED, app, logger);
  });

  app.useRpcRegex(/^debug_.*$/, async () => {
    return logAndHandleResponse('debug', [], () => predefined.NOT_YET_IMPLEMENTED, app, logger);
  });
};

export { defineOtherRoutes };
