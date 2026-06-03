// SPDX-License-Identifier: Apache-2.0

import type { Server } from 'node:http';

import { ConfigService } from '../../../config-service/services';

export function setServerTimeout(server: Server): void {
  const requestTimeoutMs = ConfigService.get('SERVER_REQUEST_TIMEOUT_MS');
  server.setTimeout(requestTimeoutMs);

  // Keep-alive and headers timeouts must outlive the keep-alive timeout enforced by
  // upstream load balancers/reverse proxies; otherwise an upstream may reuse a socket
  // the relay has already closed, surfacing as 502s to the client. Node also requires
  // headersTimeout > keepAliveTimeout.
  server.keepAliveTimeout = ConfigService.get('SERVER_KEEPALIVE_TIMEOUT_MS');
  server.headersTimeout = ConfigService.get('SERVER_HEADERS_TIMEOUT_MS');

  // Disable the server-level per-request timeout; long-running JSON-RPC calls are
  // bounded by the application-level timeout (SERVER_REQUEST_TIMEOUT_MS via setTimeout).
  server.requestTimeout = 0;
}

export function getBatchRequestsMaxSize(): number {
  return ConfigService.get('BATCH_REQUESTS_MAX_SIZE');
}

export function getLimitDuration(): number {
  return ConfigService.get('LIMIT_DURATION');
}

export function getDefaultRateLimit(): number {
  return ConfigService.get('DEFAULT_RATE_LIMIT');
}

export function getRequestIdIsOptional(): boolean {
  return ConfigService.get('REQUEST_ID_IS_OPTIONAL');
}

export function getBatchRequestsEnabled(): boolean {
  return ConfigService.get('BATCH_REQUESTS_ENABLED');
}
