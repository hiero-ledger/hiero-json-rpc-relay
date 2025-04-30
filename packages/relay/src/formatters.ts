// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { BigNumber } from '@hashgraph/sdk/lib/Transfer';
import { BigNumber as BN } from 'bignumber.js';
import crypto from 'crypto';

import constants from './lib/constants';

const EMPTY_HEX = '0x';

const hashNumber = (num) => {
  return EMPTY_HEX + num.toString(16);
};

const generateRandomHex = (bytesLength = 16) => {
  return '0x' + crypto.randomBytes(bytesLength).toString('hex');
};

/**
 * Format message prefix for logger.
 */
const formatRequestIdMessage = (requestId?: string): string => {
  if (!requestId) {
    return '';
  }
  return requestId.includes(constants.REQUEST_ID_STRING) ? requestId : `[${constants.REQUEST_ID_STRING}${requestId}]`;
};

function hexToASCII(str: string): string {
  const hex = str.toString();
  let ascii = '';
  for (let n = 0; n < hex.length; n += 2) {
    ascii += String.fromCharCode(parseInt(hex.substring(n, n + 2), 16));
  }
  return ascii;
}

function ASCIIToHex(ascii: string): string {
  const hex: string[] = [];
  for (let n = 0; n < ascii.length; n++) {
    hex.push(Number(ascii.charCodeAt(n)).toString(16));
  }
  return hex.join('');
}

/**
 * Converts an EVM ErrorMessage to a readable form. For example this :
 * 0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d53657420746f2072657665727400000000000000000000000000000000000000
 * will be converted to "Set to revert"
 * @param message
 */
const decodeErrorMessage = (message?: string): string => {
  if (!message) return '';

  // If the message does not start with 0x, it is not an error message, return it as is
  if (!message.includes(EMPTY_HEX)) return message;

  message = message.replace(/^0x/, ''); // Remove the starting 0x
  const strLen = parseInt(message.slice(8 + 64, 8 + 128), 16); // Get the length of the readable text
  const resultCodeHex = message.slice(8 + 128, 8 + 128 + strLen * 2); // Extract the hex of the text
  return hexToASCII(resultCodeHex);
};

const formatTransactionId = (transactionId: string): string | null => {
  if (!constants.TRANSACTION_ID_REGEX.test(transactionId)) {
    return null;
  }

  const transactionSplit = transactionId.split('@');
  const payer = transactionSplit[0];
  const timestamp = transactionSplit[1].replace('.', '-');
  return `${payer}-${timestamp}`;
};

/**
 * Retrieve formated transactionID without query params
 * @param transactionId The string value of the transactionId
 * @returns string | null
 */
const formatTransactionIdWithoutQueryParams = (transactionId: string): string | null => {
  // get formatted transactionID
  const formattedTransactionIdWithQueryParams = formatTransactionId(transactionId);

  // handle formattedTransactionIdWithQueryParams is empty
  if (!formattedTransactionIdWithQueryParams) {
    return null;
  }

  // split the formattedTransactionIdWithQueryParams with `?` and return the formatedID without params
  return formattedTransactionIdWithQueryParams.split('?')[0];
};

/**
 * Reads a value loaded up from the `.env` file, and converts it to a number.
 * If it is not set in `.env` or set as an empty string or other non-numeric
 * value, it uses the default value specified in constants.
 * @param envVarName The name of the env var to read in from the `.env` file
 * @param constantName The name of the constant to use as a fallback when the
 *   specified env var is invalid
 * @throws An error if both the env var and constant are invalid
 */
const parseNumericEnvVar = (envVarName: string, fallbackConstantKey: string): number => {
  // @ts-ignore
  let value: number = Number.parseInt(ConfigService.get(envVarName) ?? '', 10);
  if (!isNaN(value)) {
    return value;
  }
  value = Number.parseInt((constants[fallbackConstantKey] ?? '').toString());
  if (isNaN(value)) {
    throw new Error(`Unable to parse numeric env var: '${envVarName}', constant: '${fallbackConstantKey}'`);
  }
  return value;
};

/**
 * Converts a value in weibars (as a hex string, bigint, boolean, number, or string) to tinybars.
 *
 * @param {bigint | boolean | number | string} value - The value to convert, can be in various formats such as hex string, bigint, boolean, number, or string.
 * @returns {number} - The equivalent value in tinybars, rounded to the nearest whole number.
 */
const weibarHexToTinyBarInt = (value: bigint | boolean | number | string): number => {
  if (value === '0x') return 0;

  const weiBigInt = BigInt(value);
  const coefBigInt = BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
  // Calculate the tinybar value
  const tinybarValue = weiBigInt / coefBigInt;
  // Check if there was a fractional part that got discarded
  if (tinybarValue === BigInt(0) && weiBigInt > BigInt(0)) {
    return 1; // Round up to the smallest unit of tinybar
  }
  return Number(tinybarValue);
};

/**
 * Maps the keys and values of an object to a new object using the provided functions.
 *
 * @param target The object to map
 * @param mapFn The mapping functions
 * @param mapFn.key The function to map the keys
 * @param mapFn.value The function to map the values
 * @returns A new object with the mapped keys and values
 */
const mapKeysAndValues = <OldK extends keyof any, NewK extends keyof any, OldV, NewV>(
  target: Record<OldK, OldV>,
  mapFn: { key?: (key: OldK) => NewK; value?: (value: OldV) => NewV },
): Record<NewK, NewV> => {
  const result = {} as Record<NewK, NewV>;
  for (const key in target) {
    const newKey = mapFn.key ? mapFn.key(key) : (key as unknown as NewK);
    const newValue = mapFn.value ? mapFn.value(target[key]) : (target[key] as unknown as NewV);
    result[newKey] = newValue;
  }
  return result;
};

const strip0x = (input: string): string => {
  return input.startsWith(EMPTY_HEX) ? input.substring(2) : input;
};

const prepend0x = (input: string): string => {
  return input.startsWith(EMPTY_HEX) ? input : EMPTY_HEX + input;
};

const trimPrecedingZeros = (input: string) => {
  return parseInt(input, 16).toString(16);
};

function stripLeadingZeroForSignatures(signature: string) {
  const remove0x = (signature) => (signature.startsWith('0x') ? signature.substring(2) : signature);
  const remove0 = (signature) => (signature.startsWith('0') ? signature.substring(1) : signature);

  return '0x' + [remove0x, remove0].reduce((acc, fn) => fn(acc), signature);
}

const numberTo0x = (input: number | BigNumber | bigint): string => {
  return EMPTY_HEX + input.toString(16);
};

const nullableNumberTo0x = (input: number | BigNumber | bigint | null): string | null => {
  return input == null ? null : numberTo0x(input);
};

const nanOrNumberTo0x = (input: number | BigNumber | bigint | null): string => {
  return input == null || Number.isNaN(input) ? numberTo0x(0) : numberTo0x(input);
};

const nanOrNumberInt64To0x = (input: number | BigNumber | bigint | null): string => {
  // converting to string and then back to int is fixing a typescript warning
  if (input && Number(input) < 0) {
    // the hex of a negative number can be obtained from the binary value of that number positive value
    // the binary value needs to be negated and then to be incremented by 1

    // how the transformation works (using 16 bits)
    // a 16 bits integer variables have values from -32768 to +32767, so:
    // 0      - 0x0000 - 0000 0000 0000 0000
    // 32767  - 0x7fff - 0111 1111 1111 1111
    // -32768 - 0x8000 - 1000 0000 0000 0000
    // -1     - 0xffff - 1111 1111 1111 1111

    // converting int16 -10 will be done as following:
    // - make it positive = 10
    // - 16 bits binary value of 10 = 0000 0000 0000 1010
    // - inverse the bits = 1111 1111 1111 0101
    // - adding +1 = 1111 1111 1111 0110
    // - 1111 1111 1111 0110 bits = 0xfff6

    // we're using 64 bits integer because that's the type returned by the mirror node - int64
    const bits = 64;
    // this mathematical expression serves as a shortcut for performing the two’s complement conversion
    // e.g. input = -10
    // we have: (BigInt(1) << BigInt(bits)) = 1 << 64 = 2^64 = 18446744073709551616
    // then: (BigInt(input.toString()) + (BigInt(1) << BigInt(bits))) = -10 + 2^64 = 18446744073709551606
    // this effectively represents -10 in an unsigned 64-bit representation:18446744073709551606 = 0xFFFFFFFFFFFFFFF6
    // finally, the modulo operation: % (1 << 64)
    return numberTo0x((BigInt(input.toString()) + (BigInt(1) << BigInt(bits))) % (BigInt(1) << BigInt(bits)));
  }

  return nanOrNumberTo0x(input);
};

const toHash32 = (value: string): string => {
  return value.substring(0, 66);
};

const toNullableBigNumber = (value: string | null): string | null => {
  if (typeof value === 'string') {
    return new BN(value).toString();
  }

  return null;
};

const toNullIfEmptyHex = (value: string): string | null => {
  return value === EMPTY_HEX ? null : value;
};

const toHexString = (byteArray: Uint8Array): string => {
  const encoded = Buffer.from(byteArray).toString('hex');
  return encoded;
};

const isValidEthereumAddress = (address: string | null | undefined): boolean => {
  if (!address) {
    return false;
  }
  return new RegExp(constants.BASE_HEX_REGEX + '{40}$').test(address);
};

const isHex = (value: string): boolean => {
  const hexRegex = /^0x[0-9a-fA-F]+$/;
  return hexRegex.test(value);
};

const getFunctionSelector = (data?: string): string => {
  if (!data) return '';
  return data.replace(/^0x/, '').substring(0, 8);
};

const tinybarsToWeibars = (value: number | null, allowNegativeValues: boolean = false) => {
  if (value && value < 0) {
    // negative amount can be received only by CONTRACT_NEGATIVE_VALUE revert
    // e.g. tx https://hashscan.io/mainnet/transaction/1735241436.856862230
    // that's not a valid revert in the Ethereum world so we must NOT multiply
    // the amount sent via CONTRACT_CALL SDK call by TINYBAR_TO_WEIBAR_COEF
    // also, keep in mind that the mirror node returned amount is typed with int64
    if (allowNegativeValues) return value;

    throw new Error('Invalid value - cannot pass negative number');
  }

  if (value && value > constants.TOTAL_SUPPLY_TINYBARS)
    throw new Error('Value cannot be more than the total supply of tinybars in the blockchain');

  return value == null ? null : value * constants.TINYBAR_TO_WEIBAR_COEF;
};

export {
  hashNumber,
  formatRequestIdMessage,
  hexToASCII,
  decodeErrorMessage,
  formatTransactionId,
  formatTransactionIdWithoutQueryParams,
  parseNumericEnvVar,
  prepend0x,
  numberTo0x,
  nullableNumberTo0x,
  nanOrNumberTo0x,
  nanOrNumberInt64To0x,
  toHash32,
  toNullableBigNumber,
  toNullIfEmptyHex,
  generateRandomHex,
  trimPrecedingZeros,
  stripLeadingZeroForSignatures,
  weibarHexToTinyBarInt,
  toHexString,
  strip0x,
  isValidEthereumAddress,
  isHex,
  ASCIIToHex,
  getFunctionSelector,
  mapKeysAndValues,
  tinybarsToWeibars,
};
