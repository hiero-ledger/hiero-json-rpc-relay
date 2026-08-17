// SPDX-License-Identifier: Apache-2.0

import type Koa from 'koa';
import type { WebSocket } from 'ws';

import type ConnectionLimiter from './metrics/connectionLimiter';
import type WsMetricRegistry from './metrics/wsMetricRegistry';

/**
 * A client socket carrying the per-connection state that the `app.ws` middlewares attach to it.
 */
export interface RelayWebSocket extends WebSocket {
  id: string;
  requestId?: string;
  limiter: ConnectionLimiter;
  wsMetricRegistry: WsMetricRegistry;
  subscriptions: number;
  ipCounted?: boolean;
  inactivityTTL?: NodeJS.Timeout;
  pingIntervalId?: NodeJS.Timeout;
}

/**
 * Koa context of a websocket connection, as seen by the `app.ws` middlewares. `koa-websocket`
 * assigns the HTTP server to `app.server` on `listen()`, before any websocket middleware can run;
 * `_connections` is the Node internal used as the live connection count.
 */
export interface WsContext extends Koa.Context {
  websocket: RelayWebSocket;
  app: Koa.Context['app'] & { server: { _connections: number } };
}
