// SPDX-License-Identifier: Apache-2.0

import type { IPrestateAccountTrace, IPrestateResponse } from '../clients/models/IPrestateResponse';
import constants from '../constants';
import type { EntityTraceState, EntityTraceStateMap } from '../types';

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
