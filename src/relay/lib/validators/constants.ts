// SPDX-License-Identifier: Apache-2.0

import mainConstants from '../constants';

export const BASE_HEX_REGEX = '^0[xX][a-fA-F0-9]';
export const ADDRESS_REGEX = `${BASE_HEX_REGEX}{40}$`;
export const DEFAULT_HEX_ERROR = 'Expected 0x prefixed hexadecimal value';
export const EVEN_HEX_ERROR = `${DEFAULT_HEX_ERROR} with even length`;
export const HASH_ERROR = 'Expected 0x prefixed string representing the hash (32 bytes)';
export const ADDRESS_ERROR = 'Expected 0x prefixed string representing the address (20 bytes)';
export const BLOCK_NUMBER_ERROR =
  'Expected 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending"';
export const BLOCK_HASH_ERROR = `${HASH_ERROR} of a block`;
export const BLOCK_PARAMS_ERROR =
  'Expected 0x prefixed hexadecimal block number, the string "latest", "earliest", "pending", "safe" or "finalized", ' +
  '0x prefixed string representing the hash (32 bytes) of a block, or an EIP-1898 block object ' +
  '{"blockNumber"} / {"blockHash"[, "requireCanonical"]}';
export const TRANSACTION_HASH_ERROR = `${HASH_ERROR} of a transaction`;
export const TOPIC_HASH_ERROR = `${HASH_ERROR} of a topic`;
export const REWARD_PERCENTILES_ERROR = `Expected an array of up to ${mainConstants.FEE_HISTORY_REWARD_PERCENTILES_MAX_SIZE} numbers, each between 0 and 100`;
export const topicsError = (maxSubTopics: number): string =>
  `Expected an array or array of arrays containing 0x prefixed strings representing topic hashes (32 bytes), with at most ${mainConstants.LOG_TOPICS_MAX_POSITIONS} positions and at most ${maxSubTopics} topics per position`;
export const BLOCK_PARAM_OBJECT_KEYS = ['blockNumber', 'blockHash', 'requireCanonical'];
export const BLOCK_PARAM_OBJECT_UNKNOWN_KEY_ERROR = (key: string): string =>
  `Unknown parameter '${key}' in EIP-1898 block object`;
export const BLOCK_PARAM_OBJECT_BOTH_ERROR = 'cannot specify both blockHash and blockNumber, choose one or the other';
export const BLOCK_PARAM_OBJECT_NEITHER_ERROR = 'must specify either blockHash or blockNumber';
export const BLOCK_PARAM_OBJECT_REQUIRE_CANONICAL_ERROR = 'requireCanonical is only allowed with blockHash';
export const INVALID_BLOCK_HASH_TAG_NUMBER = 'The value passed is not a valid blockHash/blockNumber/blockTag value:';
export enum TracerType {
  CallTracer = 'callTracer',
  OpcodeLogger = 'opcodeLogger',
  PrestateTracer = 'prestateTracer',
}
