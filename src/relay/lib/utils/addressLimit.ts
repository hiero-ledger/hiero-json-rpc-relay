// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '../../../config-service/services';
import { predefined } from '../errors/JsonRpcError';

/**
 * Counts the caller-supplied addresses in a log-filter `address` field (single = 1, array = length, absent = 0).
 *
 * @param address - The `address` filter value: a single address, an array of addresses, or null/undefined.
 * @returns The number of caller-supplied addresses.
 */
export function countAddresses(address: unknown): number {
  if (address === null || address === undefined) {
    return 0;
  }

  return Array.isArray(address) ? address.length : 1;
}

/**
 * Enforces the shared `MAX_ADDRESSES_PER_REQUEST` cap on a single request's address filter, before any Mirror Node fan-out.
 *
 * @param address - The `address` filter value to bound.
 * @throws {JsonRpcError} INVALID_PARAMETER when the address count exceeds `MAX_ADDRESSES_PER_REQUEST`.
 */
export function assertAddressCountWithinLimit(address: unknown): void {
  const maxAddresses = ConfigService.get('MAX_ADDRESSES_PER_REQUEST');
  const count = countAddresses(address);
  if (count > maxAddresses) {
    throw predefined.INVALID_PARAMETER('address', `A maximum of ${maxAddresses} addresses are allowed`);
  }
}

// Param index holding each method's address filter (eth_getLogs at params[0], eth_subscribe at params[1]).
const ADDRESS_PARAM_INDEX: Readonly<Record<string, number>> = {
  eth_getLogs: 0,
  eth_subscribe: 1,
};

// Methods the HTTP batch handler counts (eth_subscribe is not served over HTTP).
export const HTTP_BATCH_ADDRESS_METHODS: ReadonlySet<string> = new Set(['eth_getLogs']);

// Methods the WebSocket batch handler counts (both are servable over a WS batch).
export const WS_BATCH_ADDRESS_METHODS: ReadonlySet<string> = new Set(['eth_getLogs', 'eth_subscribe']);

// Counts addresses in one entry's params; returns 0 for non-address methods, malformed params, or no address.
function countAddressesInEntry(method: string, params: unknown): number {
  const index = ADDRESS_PARAM_INDEX[method];
  if (index === undefined || !Array.isArray(params)) {
    return 0;
  }

  const filter = params[index];
  if (filter === null || typeof filter !== 'object') {
    return 0;
  }

  return countAddresses((filter as { address?: unknown }).address);
}

/**
 * Sums addresses across a JSON-RPC batch for the given methods, so batching can't multiply the per-request cap.
 *
 * @param batch - The parsed JSON-RPC batch (array of request entries).
 * @param countedMethods - The methods whose addresses count toward the total for this transport.
 * @returns The total number of caller-supplied addresses across the batch.
 */
export function countBatchAddresses(batch: unknown[], countedMethods: ReadonlySet<string>): number {
  let total = 0;

  for (const entry of batch) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }

    const { method, params } = entry as { method?: unknown; params?: unknown };
    if (typeof method !== 'string' || !countedMethods.has(method)) {
      continue;
    }

    total += countAddressesInEntry(method, params);
  }

  return total;
}
