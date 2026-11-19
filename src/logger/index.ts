// SPDX-License-Identifier: Apache-2.0

import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/**
 * The `name` written on every log line. Child loggers must not override it; they set {@link MODULE_KEY} instead.
 */
export const ROOT_LOGGER_NAME = 'hedera-json-rpc-relay';

/**
 * The binding key child loggers use to say which part of the relay wrote a line,
 * e.g. `logger.child({ module: 'mirror-node' })`.
 */
export const MODULE_KEY = 'module';

/**
 * Per-request values the {@link logMixin} adds to every line logged while serving that request.
 */
export interface LogContextStore {
  requestId: string;
  connectionId?: string;
  method?: string;
}

/**
 * Request-scoped log context shared by the HTTP server, the WebSocket server and the worker tasks.
 *
 * @see https://nodejs.org/api/async_context.html#asynchronous-context-tracking
 */
export const logContext = new AsyncLocalStorage<LogContextStore>();

/**
 * Adds the request ID, connection ID and JSON-RPC method of the request being served, when known.
 *
 * @see https://github.com/pinojs/pino/blob/main/docs/api.md#mixin-function
 */
export function logMixin(): Record<string, string> {
  const store = logContext.getStore();
  if (!store) {
    return {};
  }

  return {
    ...(store.connectionId && { connectionId: `[Connection ID: ${store.connectionId}] ` }),
    requestId: `[Request ID: ${store.requestId}] `,
    ...(store.method && { method: store.method }),
  };
}

/**
 * Records the JSON-RPC method on the current request's log context, so every line logged from here on
 * for that request carries it. Does nothing outside a request.
 *
 * Use it when the context holds a single JSON-RPC call; for the items of a batch use {@link runWithLogMethod}.
 *
 * @param method - The JSON-RPC method being served; ignored unless it is a string (it comes from the client).
 */
export function setLogMethod(method: unknown): void {
  const store = logContext.getStore();
  if (store && typeof method === 'string') {
    store.method = method;
  }
}

/**
 * Runs `fn` with the JSON-RPC method added to a copy of the current request's log context,
 * leaving the outer context unchanged (each item of a batch gets its own method).
 * Outside a request `fn` runs as is.
 *
 * @param method - The JSON-RPC method being served; ignored unless it is a string (it comes from the client).
 * @param fn - The work to run.
 * @returns What `fn` returns.
 */
export function runWithLogMethod<T>(method: unknown, fn: () => T): T {
  const store = logContext.getStore();
  return store && typeof method === 'string' ? logContext.run({ ...store, method }, fn) : fn();
}

/**
 * Runs `fn` with a log context for the given request, unless one is already active
 * (e.g. a worker task running on the main thread inside the request that queued it).
 *
 * @param requestDetails - The request the work belongs to; nothing is set without a request ID.
 * @param fn - The work to run.
 * @returns What `fn` returns.
 */
export function runWithRequestLogContext<T>(
  requestDetails: { requestId?: string; connectionId?: string } | undefined,
  fn: () => T,
): T {
  if (logContext.getStore() || !requestDetails?.requestId) {
    return fn();
  }
  return logContext.run({ requestId: requestDetails.requestId, connectionId: requestDetails.connectionId }, fn);
}

/**
 * Collapses repeated binding keys so a line holds each key once, keeping the innermost value.
 * Nested children (`rpc-server` → `relay` → `mirror-node`) would otherwise write `"module"` once per level,
 * and JSON parsers keep only one of them.
 */
function dedupeChildBindings(child: Logger): void {
  // pino keeps the serialized bindings (`,"key":value,...`) under this symbol, exported for integrations.
  const instance = child as unknown as Record<symbol, string | undefined>;
  const chindings = instance[pino.symbols.chindingsSym];
  if (!chindings) {
    return;
  }
  const bindings = JSON.parse(`{${chindings.slice(1)}}`) as Record<string, unknown>;
  instance[pino.symbols.chindingsSym] = Object.entries(bindings)
    .map(([key, value]) => `,${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join('');
}

export interface CreateLoggerOptions {
  /** The minimum level to log (`trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`). */
  level: string;
  /** `true` writes human-readable lines through `pino-pretty`; `false` writes one JSON object per line. */
  prettyLogsEnabled: boolean;
}

/**
 * Builds a root logger. Every root logger in the relay (HTTP, WebSocket, config service, worker threads)
 * is created here, so they share the same `name`, level, request mixin and output format.
 *
 * In JSON mode the level is written as text (`"level":"info"`), so log collectors such as Loki
 * can read it without a numeric mapping.
 *
 * @param options - Level and output format.
 * @param destination - Where JSON lines are written (stdout by default); ignored in pretty mode.
 * @returns The root logger; create per-module loggers with `logger.child({ module: '<name>' })`.
 */
export function createLogger(
  { level, prettyLogsEnabled }: CreateLoggerOptions,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    name: ROOT_LOGGER_NAME,
    level,
    mixin: logMixin,
    onChild: dedupeChildBindings,
  };

  if (prettyLogsEnabled) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: true,
        messageFormat: `{if ${MODULE_KEY}}[{${MODULE_KEY}}] {end}{connectionId}{requestId}{msg}`,
        // Ignore one or several keys, nested keys are supported with each property delimited by a dot character (`.`)
        ignore: `${MODULE_KEY},connectionId,requestId,method`,
      },
    };
  } else {
    options.formatters = {
      level: (label: string): { level: string } => ({ level: label }),
    };
  }

  return prettyLogsEnabled || !destination ? pino(options) : pino(options, destination);
}
