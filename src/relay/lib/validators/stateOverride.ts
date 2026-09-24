// SPDX-License-Identifier: Apache-2.0

import { isHex } from '../../formatters';
import constants from '../constants';
import { predefined } from '../errors/JsonRpcError';
import type { IAccountOverride, StateOverrideSet } from '../types';
import * as Constants from './constants';

const PARAM = 'stateOverride';

const ADDRESS_PATTERN = new RegExp(Constants.ADDRESS_REGEX);
const SLOT_PATTERN = new RegExp(`${Constants.BASE_HEX_REGEX}{64}$`);

/**
 * Validates the state override set accepted as the third parameter of `eth_call` and
 * `eth_estimateGas`, throwing `INVALID_PARAMETER` with the offending field on the first problem.
 *
 * Limits match what the mirror node accepts, enforced here so that oversized requests fail with a
 * parameter error instead of the mirror node's generic simulation error.
 *
 * @param {unknown} param - The override set as received from the caller.
 */
export function validateStateOverrideSet(param: unknown): void {
  if (typeof param !== 'object' || param === null || Array.isArray(param)) {
    throw predefined.INVALID_PARAMETER(PARAM, 'Expected an object keyed by address');
  }

  const overrides = param as StateOverrideSet;
  const addresses = Object.keys(overrides);

  if (addresses.length > constants.STATE_OVERRIDE_MAX_ADDRESSES) {
    throw predefined.INVALID_PARAMETER(
      PARAM,
      `Exceeds the maximum of ${constants.STATE_OVERRIDE_MAX_ADDRESSES} addresses per request`,
    );
  }

  for (const address of addresses) {
    if (!ADDRESS_PATTERN.test(address)) {
      throw predefined.INVALID_PARAMETER(PARAM, `'${address}' is not a valid 20 byte address`);
    }

    validateAccountOverride(address, overrides[address]);
  }
}

function validateAccountOverride(address: string, override: IAccountOverride): void {
  if (typeof override !== 'object' || override === null || Array.isArray(override)) {
    throw predefined.INVALID_PARAMETER(PARAM, `'${address}' must map to an object`);
  }

  if (hasOwnProperty(override, 'movePrecompileToAddress')) {
    throw predefined.INVALID_PARAMETER(PARAM, `'movePrecompileToAddress' is not supported`);
  }

  if (override.balance !== undefined) {
    requireHex(address, 'balance', override.balance);
  }

  if (override.nonce !== undefined) {
    requireHex(address, 'nonce', override.nonce);
    // The mirror node reads the nonce as unsigned and then rejects anything negative as a signed
    // long, so the top half of the 64-bit range fails only after passing its format check.
    if (BigInt(override.nonce) > constants.INT64_MAX) {
      throw predefined.INVALID_PARAMETER(PARAM, `'${address}' nonce exceeds the maximum of ${constants.INT64_MAX}`);
    }
  }

  if (override.code !== undefined) {
    requireHex(address, 'code', override.code, true);
    if (override.code.length > constants.STATE_OVERRIDE_MAX_CODE_LENGTH) {
      throw predefined.INVALID_PARAMETER(
        PARAM,
        `'${address}' code exceeds the maximum of ${constants.STATE_OVERRIDE_MAX_CODE_LENGTH} characters`,
      );
    }
  }

  if (hasOwnProperty(override, 'state') && hasOwnProperty(override, 'stateDiff')) {
    throw predefined.INVALID_PARAMETER(PARAM, `'${address}' has both 'state' and 'stateDiff'`);
  }

  if (override.state !== undefined) {
    validateStorage(address, 'state', override.state);
  }

  if (override.stateDiff !== undefined) {
    validateStorage(address, 'stateDiff', override.stateDiff);
  }
}

function validateStorage(address: string, field: string, storage: Record<string, string>): void {
  if (typeof storage !== 'object' || storage === null || Array.isArray(storage)) {
    throw predefined.INVALID_PARAMETER(PARAM, `'${address}' ${field} must be an object`);
  }

  const slots = Object.entries(storage);
  if (slots.length > constants.STATE_OVERRIDE_MAX_SLOTS) {
    throw predefined.INVALID_PARAMETER(
      PARAM,
      `'${address}' ${field} exceeds the maximum of ${constants.STATE_OVERRIDE_MAX_SLOTS} slots`,
    );
  }

  for (const [key, value] of slots) {
    if (!SLOT_PATTERN.test(key) || !SLOT_PATTERN.test(value)) {
      throw predefined.INVALID_PARAMETER(
        PARAM,
        `'${address}' ${field} slots must be 0x prefixed 32 byte hexadecimal values`,
      );
    }
  }
}

function requireHex(address: string, field: string, value: string, allowEmpty = false): void {
  const empty = allowEmpty && value === constants.EMPTY_HEX;
  if (typeof value !== 'string' || (!empty && !isHex(value))) {
    throw predefined.INVALID_PARAMETER(PARAM, `'${address}' ${field} ${Constants.DEFAULT_HEX_ERROR.toLowerCase()}`);
  }
}

function hasOwnProperty(override: IAccountOverride, field: keyof IAccountOverride): boolean {
  return Object.prototype.hasOwnProperty.call(override, field);
}
