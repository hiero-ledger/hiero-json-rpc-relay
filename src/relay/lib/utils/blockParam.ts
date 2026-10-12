// SPDX-License-Identifier: Apache-2.0

/**
 * An EIP-1898 block identifier object: exactly one of `blockNumber` / `blockHash`, plus an optional
 * `requireCanonical` flag that is only meaningful together with `blockHash`.
 *
 * @see https://eips.ethereum.org/EIPS/eip-1898
 */
export interface BlockParamObject {
  blockNumber?: string;
  blockHash?: string;
  requireCanonical?: boolean;
}

/**
 * A default block parameter: a block number, a block tag, a block hash, or an EIP-1898 block identifier object.
 */
export type BlockParam = string | BlockParamObject;

/**
 * Matches a 0x prefixed 32 byte block hash.
 */
const BLOCK_HASH_REGEX = /^0[xX][a-fA-F0-9]{64}$/;

/**
 * Checks whether a default block parameter string is a 32 byte block hash.
 *
 * @param blockParam - The default block parameter to check.
 * @returns `true` when the value is a 0x prefixed 32 byte hex string.
 */
export function isBlockHash(blockParam: unknown): blockParam is string {
  return typeof blockParam === 'string' && BLOCK_HASH_REGEX.test(blockParam);
}

/**
 * Collapses an EIP-1898 block identifier object into the equivalent default block parameter string, so that
 * everything downstream of the parameter layout (the `@cache` decorator and services) only ever sees
 * a block number, tag or hash.
 *
 * @param blockParam - The validated default block parameter.
 * @returns The block number, tag or hash the parameter refers to; non-object values are returned unchanged.
 */
export function normalizeBlockParam(blockParam: unknown): unknown {
  if (blockParam === null || typeof blockParam !== 'object' || Array.isArray(blockParam)) {
    return blockParam;
  }

  const { blockHash, blockNumber } = blockParam as BlockParamObject;
  return blockHash ?? blockNumber;
}
