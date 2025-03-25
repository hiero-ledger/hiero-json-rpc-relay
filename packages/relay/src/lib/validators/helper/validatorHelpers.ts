// SPDX-License-Identifier: Apache-2.0

import { IObjectValidator } from '../../types';
import { PRIMITIVE_VALIDATORS } from '../primitiveValidators';

/**
 * Validates an array of items against a type
 *
 * @param array - The array to validate
 * @param innerType - The type of items in the array
 * @returns True if validation passes
 */
export function validateArray(array: any[], innerType?: string): boolean {
  if (!innerType) return true;

  const validator = PRIMITIVE_VALIDATORS[innerType];
  if (!validator) return false;

  return array.every((element) => validator.test(element));
}

/**
 * Validates an object against an object validator
 *
 * @param object - The object to validate
 * @param objectValidator - The object validator
 * @returns True if validation passes
 */
export function validateObject<T extends object = any>(object: T, objectValidator: IObjectValidator<T>): boolean {
  return objectValidator.validate();
}

/**
 * Checks if a parameter is valid and non-nullable
 *
 * @param param - The parameter value
 * @param nullable - Whether the parameter can be null
 * @returns True if the parameter is valid and non-nullable
 */
export function isValidAndNonNullableParam(param: any, nullable: boolean): boolean {
  return param !== undefined && (param !== null || !nullable);
}

/**
 * Checks if a required parameter is missing
 *
 * @param param - The parameter value
 * @param required - Whether the parameter is required
 * @returns True if the parameter is required and missing
 */
export function requiredIsMissing(param: any, required: boolean | undefined): boolean {
  return required === true && param === undefined;
}

/**
 * Constants for validators
 */
export const ValidatorConstants = {
  // Regex patterns
  BASE_HEX_REGEX: '^0[xX][a-fA-F0-9]',
  TRANSACTION_ID_REGEX: /^(\d)\.(\d)\.(\d{1,10})-(\d{1,19})-(\d{1,9})$/,
  BLOCK_NUMBER_REGEX: /^0[xX]([1-9A-Fa-f][0-9A-Fa-f]{0,13}|0)$/,

  // Error messages
  DEFAULT_HEX_ERROR: 'Expected 0x prefixed hexadecimal value',
  EVEN_HEX_ERROR: `Expected 0x prefixed hexadecimal value with even length`,
  HASH_ERROR: 'Expected 0x prefixed string representing the hash (32 bytes)',
  ADDRESS_ERROR: 'Expected 0x prefixed string representing the address (20 bytes)',
  BLOCK_NUMBER_ERROR:
    'Expected 0x prefixed hexadecimal block number, or the string "latest", "earliest", "pending", "safe", or "finalized"',
  BLOCK_PARAMS_ERROR: `Expected 0x prefixed string representing the hash (32 bytes) in object, 0x prefixed hexadecimal block number, or the string "latest", "earliest", "pending", "safe", or "finalized"`,
  BLOCK_HASH_ERROR: `Expected 0x prefixed string representing the hash (32 bytes) of a block`,
  TRANSACTION_HASH_ERROR: `Expected 0x prefixed string representing the hash (32 bytes) of a transaction`,
  TRANSACTION_ID_ERROR: `Expected a transaction ID string in the format "shard.realm.num-sss-nnn" where sss are seconds and nnn are nanoseconds`,
  TOPIC_HASH_ERROR: `Expected 0x prefixed string representing the hash (32 bytes) of a topic`,
  INVALID_BLOCK_HASH_TAG_NUMBER: 'The value passed is not a valid blockHash/blockNumber/blockTag value:',

  // block tag array
  ACCEPTABLE_BLOCK_TAGS: ['earliest', 'latest', 'pending', 'finalized', 'safe'],
};
