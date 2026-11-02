// SPDX-License-Identifier: Apache-2.0

import { isEmptyAccount } from '../../formatters';
import type { IPrestateAccountTrace, IPrestateResponse } from '../clients/models/IPrestateResponse';
import constants from '../constants';
import type { EntityTraceState, EntityTraceStateMap, IPrestateTracerConfig } from '../types';

/**
 * Converts a single mirror node account trace into the tracer's entity state.
 *
 * The mirror node leaves `code` and `nonce` unset rather than defaulting them, so an account with no
 * bytecode arrives as null and has to be restored to the geth representation.
 */
const toEntityTraceState = (accountTrace: IPrestateAccountTrace): EntityTraceState => {
  return {
    balance: accountTrace.balance,
    nonce: accountTrace.nonce ?? 0,
    code: accountTrace.code ?? constants.EMPTY_HEX,
    storage: accountTrace.storage ?? {},
  };
};

/**
 * Maps a mirror node prestate response onto the address-keyed map that `prestateTracer` returns.
 *
 * The mirror node returns a list of account traces carrying their own `address`, while geth - and
 * therefore the relay - returns a map keyed by that address.
 *
 * @param response - The response of the mirror node prestate endpoint.
 * @returns The touched entities keyed by their lowercase EVM address.
 */
export const mapPrestateResponse = (response: IPrestateResponse): EntityTraceStateMap => {
  const result: EntityTraceStateMap = {};

  for (const accountTrace of response?.pre ?? []) {
    if (!accountTrace?.address) {
      continue;
    }

    result[accountTrace.address.toLowerCase()] = toEntityTraceState(accountTrace);
  }

  return result;
};

/**
 * Applies the geth prestateTracer options to a prestate result.
 *
 * Empty accounts are dropped unless `includeEmpty` is set, before `disableCode` strips the code the
 * check depends on. Returns a new map, since the input is usually a cached result.
 *
 * @param prestate - The full prestate, keyed by EVM address.
 * @param config - The prestateTracer options.
 * @returns The prestate with the options applied.
 */
export const applyPrestateTracerConfig = (
  prestate: EntityTraceStateMap,
  config: IPrestateTracerConfig = {},
): EntityTraceStateMap => {
  const result: EntityTraceStateMap = {};

  for (const [address, state] of Object.entries(prestate)) {
    if (!config.includeEmpty && isEmptyAccount(state)) {
      continue;
    }

    const trimmed: EntityTraceState = { ...state };

    if (config.disableCode) {
      delete trimmed.code;
    }

    if (config.disableStorage) {
      delete trimmed.storage;
    }

    result[address] = trimmed;
  }

  return result;
};
