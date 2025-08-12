// SPDX-License-Identifier: Apache-2.0

import type { Server } from 'node:http';

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

export function setServerTimeout(server: Server): void {
  const requestTimeoutMs = ConfigService.get('SERVER_REQUEST_TIMEOUT_MS');
  server.setTimeout(requestTimeoutMs);
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
