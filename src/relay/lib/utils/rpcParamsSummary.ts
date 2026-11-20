// SPDX-License-Identifier: Apache-2.0

import { keccak256 } from 'ethers/crypto';

/** Strings up to this length (a 32-byte hash with `0x`) are logged as is; longer ones only by size. */
const MAX_LOGGED_STRING_LENGTH = 66;

/** Arrays up to this length are logged item by item; longer ones only by count. */
const MAX_LOGGED_ARRAY_LENGTH = 10;

/** Nested objects deeper than this are logged as `<object>`. */
const MAX_LOGGED_DEPTH = 3;

const HEX_STRING = /^0x[0-9a-fA-F]*$/;

/**
 * Returns the byte size of a `0x` hex string, or its length for any other string.
 */
function sizeOf(value: string): string {
  return HEX_STRING.test(value) ? `${(value.length - 2) / 2} bytes` : `${value.length} chars`;
}

/**
 * Copies a value for logging, replacing long strings (call data, raw transactions), long arrays and
 * deeply nested objects with their size.
 */
function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_LOGGED_STRING_LENGTH ? `<${sizeOf(value)}>` : value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_LOGGED_DEPTH) {
    return '<object>';
  }
  if (Array.isArray(value)) {
    return value.length > MAX_LOGGED_ARRAY_LENGTH
      ? `<${value.length} items>`
      : value.map((item) => redact(item, depth + 1));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, depth + 1)]));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Block range, block hash and address count of an `eth_getLogs` filter. */
function summarizeLogsFilter(filter: unknown): Record<string, unknown> {
  const { fromBlock, toBlock, blockHash, address } = asRecord(filter);
  return {
    fromBlock: redact(fromBlock),
    toBlock: redact(toBlock),
    ...(blockHash !== undefined && { blockHash: redact(blockHash) }),
    addresses: Array.isArray(address) ? address.length : address == null ? 0 : 1,
  };
}

/** `from`, `to`, call data size and block of an `eth_call` or `eth_estimateGas`. */
function summarizeCall(call: unknown, block: unknown): Record<string, unknown> {
  const { from, to, data, input } = asRecord(call);
  const callData = data ?? input;
  return {
    from: redact(from),
    to: redact(to),
    dataSize: typeof callData === 'string' ? sizeOf(callData) : 0,
    ...(block !== undefined && { block: redact(block) }),
  };
}

/** Hash and size of an `eth_sendRawTransaction` payload. */
function summarizeRawTransaction(rawTransaction: unknown): Record<string, unknown> {
  if (typeof rawTransaction !== 'string' || !HEX_STRING.test(rawTransaction) || rawTransaction.length % 2 !== 0) {
    return { rawTransaction: redact(rawTransaction) };
  }
  return { txHash: keccak256(rawTransaction), size: sizeOf(rawTransaction) };
}

/**
 * Builds a short summary of the params of a JSON-RPC call for `ERROR` and `WARN` lines, so a failed request
 * can be traced without logging call data or raw transactions. Full params are logged only at `DEBUG`.
 *
 * - `eth_getLogs`: the block range and the number of addresses;
 * - `eth_call`, `eth_estimateGas`: `from`, `to`, the call data size and the block;
 * - `eth_sendRawTransaction`: the transaction hash and size;
 * - any other method: the params with long strings and arrays replaced by their size.
 *
 * @param method - The JSON-RPC method.
 * @param params - The params the method was called with.
 * @returns A summary safe to log at any level.
 */
export function summarizeRpcParams(method: string, params: unknown): unknown {
  const list = Array.isArray(params) ? params : [];
  switch (method) {
    case 'eth_getLogs':
      return summarizeLogsFilter(list[0]);
    case 'eth_call':
    case 'eth_estimateGas':
      return summarizeCall(list[0], list[1]);
    case 'eth_sendRawTransaction':
      return summarizeRawTransaction(list[0]);
    default:
      return redact(params);
  }
}
