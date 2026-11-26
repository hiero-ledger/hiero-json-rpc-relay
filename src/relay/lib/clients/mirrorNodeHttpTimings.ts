// SPDX-License-Identifier: Apache-2.0

import diagnosticsChannel from 'diagnostics_channel';
import type { Agent, ClientRequest, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { performance } from 'perf_hooks';

/**
 * Phases of one HTTP attempt to the Mirror Node, in the order they happen.
 *
 * - `pool_wait`: from creating the request until the agent hands it a socket. High when the pool is at
 *   `MIRROR_NODE_HTTP_MAX_SOCKETS` and the request waits in the agent's queue.
 * - `dns`, `connect`, `tls`: only for a new socket; DNS lookup, TCP connect and TLS handshake.
 * - `ttfb`: from the request being sent on a ready socket until the response headers arrive. This is the closest
 *   measure of the Mirror Node's own latency plus the network round trip.
 * - `download`: from the response headers until the last byte of the body.
 *
 * Every timestamp is taken in a JS callback, so each phase also includes any event-loop lag that delayed it.
 */
export type HttpAttemptPhase = 'pool_wait' | 'dns' | 'connect' | 'tls' | 'ttfb' | 'download';

/** Whether the attempt ran on a socket the agent opened for it, or on one kept alive from an earlier request. */
export type SocketKind = 'new' | 'reused';

export interface HttpAttemptTimings {
  readonly socketKind: SocketKind;
  /** Phase durations in milliseconds; a phase is absent when the attempt did not reach it. */
  readonly phases: Partial<Record<HttpAttemptPhase, number>>;
}

interface Marks {
  created: number;
  socket?: number;
  lookup?: number;
  connect?: number;
  secureConnect?: number;
  finish?: number;
  response?: number;
  end?: number;
  reused?: boolean;
}

const MARKS = Symbol('mirrorNodeHttpTimingMarks');

/** `agent` and `protocol` are set on every ClientRequest but missing from Node's typings. */
type MarkedRequest = ClientRequest & { [MARKS]?: Marks; agent?: Agent; protocol?: string };

/**
 * Agents whose requests are timed, with what to call when one of their requests opens a new socket. Only the Mirror
 * Node clients register theirs, so other HTTP traffic is ignored.
 */
const timedAgents = new WeakMap<Agent, () => void>();

let subscribed = false;

/**
 * Starts timing every request sent through the given agent. The first call subscribes to Node's
 * `http.client.request.created` diagnostics channel, which fires before the agent assigns a socket, so the wait for
 * a free socket in the pool is included.
 *
 * @param agent - An HTTP or HTTPS agent of a Mirror Node axios client.
 * @param onNewSocket - Called when a request of this agent is given a socket that is still connecting.
 */
export function timeRequestsOf(agent: Agent, onNewSocket: () => void = (): void => {}): void {
  timedAgents.set(agent, onNewSocket);
  if (!subscribed) {
    diagnosticsChannel.subscribe('http.client.request.created', onRequestCreated);
    subscribed = true;
  }
}

function onRequestCreated(message: unknown): void {
  const request = (message as { request?: MarkedRequest }).request;
  const onNewSocket = request?.agent && timedAgents.get(request.agent);
  if (!request || !onNewSocket) {
    return;
  }

  const marks: Marks = { created: performance.now() };
  request[MARKS] = marks;

  request.once('socket', (socket: Socket) => {
    marks.socket = performance.now();
    // A kept-alive socket is already connected; a new one is still connecting when it is handed over.
    marks.reused = !socket.connecting;
    if (socket.connecting) {
      onNewSocket();
      socket.once('lookup', () => (marks.lookup = performance.now()));
      socket.once('connect', () => (marks.connect = performance.now()));
      socket.once('secureConnect', () => (marks.secureConnect = performance.now()));
    }
  });
  request.once('finish', () => (marks.finish = performance.now()));
  request.once('response', (response: IncomingMessage) => {
    marks.response = performance.now();
    response.once('end', () => (marks.end = performance.now()));
  });
}

/**
 * Finds the native request behind what axios exposes as `response.request` or `error.request`. With redirects
 * enabled, a failed request is a follow-redirects wrapper that keeps the native request in `_currentRequest`.
 */
function markedRequestOf(request: unknown): MarkedRequest | undefined {
  if (request == null || typeof request !== 'object') {
    return undefined;
  }
  const candidate = request as MarkedRequest & { _currentRequest?: MarkedRequest };
  return candidate[MARKS] ? candidate : candidate._currentRequest?.[MARKS] ? candidate._currentRequest : undefined;
}

/**
 * Splits one attempt into phases. When the attempt ended before a phase finished (for example it timed out while
 * waiting for a socket, or for the response headers), that phase is closed at `endedAt`, so a timeout shows up in the
 * phase it was stuck in.
 *
 * @param request - `response.request` or `error.request` from axios.
 * @param endedAt - `performance.now()` when the caller saw the attempt end.
 * @returns The phase timings, or `undefined` when the request was not timed (for example a mocked adapter).
 */
export function attemptTimingsOf(
  request: unknown,
  endedAt: number = performance.now(),
): HttpAttemptTimings | undefined {
  const marks = markedRequestOf(request)?.[MARKS];
  if (!marks) {
    return undefined;
  }

  const phases: Partial<Record<HttpAttemptPhase, number>> = {};
  const span = (from: number, to: number | undefined): number => Math.max(0, (to ?? endedAt) - from);

  phases.pool_wait = span(marks.created, marks.socket);
  if (marks.socket === undefined) {
    return { socketKind: 'new', phases };
  }

  let ready = marks.socket;
  if (!marks.reused) {
    if (marks.lookup !== undefined || marks.connect === undefined) {
      phases.dns = span(ready, marks.lookup);
      if (marks.lookup === undefined) {
        return { socketKind: 'new', phases };
      }
      ready = marks.lookup;
    }
    phases.connect = span(ready, marks.connect);
    if (marks.connect === undefined) {
      return { socketKind: 'new', phases };
    }
    ready = marks.connect;
    if (marks.secureConnect !== undefined || isTlsRequest(request)) {
      phases.tls = span(ready, marks.secureConnect);
      if (marks.secureConnect === undefined) {
        return { socketKind: 'new', phases };
      }
      ready = marks.secureConnect;
    }
  }

  const socketKind: SocketKind = marks.reused ? 'reused' : 'new';
  const sent = Math.max(ready, marks.finish ?? ready);
  phases.ttfb = span(sent, marks.response);
  if (marks.response === undefined) {
    return { socketKind, phases };
  }
  phases.download = span(marks.response, marks.end);
  return { socketKind, phases };
}

/** Whether the native request went over TLS, so a missing `secureConnect` means the handshake never finished. */
function isTlsRequest(request: unknown): boolean {
  return markedRequestOf(request)?.protocol === 'https:';
}
