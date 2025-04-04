// SPDX-License-Identifier: Apache-2.0

export const BASE_HEX_REGEX = '^0[xX][a-fA-F0-9]';
export const ERROR_CODE = -32602;
export const DEFAULT_HEX_ERROR = 'Expected 0x prefixed hexadecimal value';
export const EVEN_HEX_ERROR = `${DEFAULT_HEX_ERROR} with even length`;
export const HASH_ERROR = 'Expected 0x prefixed string representing the hash (32 bytes)';
export const ADDRESS_ERROR = 'Expected 0x prefixed string representing the address (20 bytes)';
export const BLOCK_NUMBER_ERROR =
  'Expected 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending"';
export const BLOCK_PARAMS_ERROR = `Expected ${HASH_ERROR} in object, 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending"`;
export const BLOCK_HASH_ERROR = `Expected ${HASH_ERROR} of a block`;
export const TRANSACTION_HASH_ERROR = `Expected ${HASH_ERROR} of a transaction`;
export const TRANSACTION_ID_ERROR = `Expected a transaction ID string in the format "shard.realm.num-sss-nnn" where sss are seconds and nnn are nanoseconds`;
export const TRANSACTION_ID_REGEX = /^(\d)\.(\d)\.(\d{1,10})-(\d{1,19})-(\d{1,9})$/;
export const TOPIC_HASH_ERROR = `Expected ${HASH_ERROR} of a topic`;
export const INVALID_BLOCK_HASH_TAG_NUMBER = 'The value passed is not a valid blockHash/blockNumber/blockTag value:';
export enum TracerType {
  CallTracer = 'callTracer',
  OpcodeLogger = 'opcodeLogger',
}
