// SPDX-License-Identifier: Apache-2.0

import type { Server } from 'node:http';

import { ConfigService } from '../../../config-service/services';

export function setServerTimeout(server: Server): void {
  const requestTimeoutMs = ConfigService.get('SERVER_REQUEST_TIMEOUT_MS');
  server.setTimeout(requestTimeoutMs);

  // Keep-alive and headers timeouts must exceed GCP's non-configurable 600s GFE
  // backend keep-alive limit; otherwise the GFE reuses a socket Node has already
  // closed and clients see 502 backend_connection_closed_before_data_sent_to_client.
  // Node also requires headersTimeout > keepAliveTimeout.
  server.keepAliveTimeout = ConfigService.get('SERVER_KEEPALIVE_TIMEOUT_MS');
  server.headersTimeout = ConfigService.get('SERVER_HEADERS_TIMEOUT_MS');
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
