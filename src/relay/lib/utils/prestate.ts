// SPDX-License-Identifier: Apache-2.0

import { isEmptyAccount } from '../../formatters';
import type {
  IPrestateAccountTrace,
  IPrestatePostAccountTrace,
  IPrestateResponse,
} from '../clients/models/IPrestateResponse';
import constants from '../constants';
import type {
  ChangedEntityTraceState,
  EntityTraceState,
  EntityTraceStateMap,
  IPrestateTracerConfig,
  PrestateDiffResult,
} from '../types';

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
 * Empty accounts are dropped only on request, before `disableCode` strips the code the check depends on.
 * Returns a new map, since the input is usually a cached result.
 *
 * @param prestate - The full prestate, keyed by EVM address.
 * @param config - The prestateTracer options.
 * @returns The prestate with the options applied.
 */
export const applyPrestateTracerConfig = (
  prestate: EntityTraceStateMap,
  config: IPrestateTracerConfig = {},
): EntityTraceStateMap => {
  // Unlike geth, empty accounts are kept by default: the mirror node reports nonce 0 for most accounts
  const { disableCode, disableStorage, includeEmpty = true } = config;

  const result: EntityTraceStateMap = {};

  for (const [address, state] of Object.entries(prestate)) {
    if (!includeEmpty && isEmptyAccount(state)) {
      continue;
    }

    const trimmed: EntityTraceState = { ...state };

    if (disableCode) {
      delete trimmed.code;
    }

    if (disableStorage) {
      delete trimmed.storage;
    }

    result[address] = trimmed;
  }

  return result;
};

/**
 * Keeps only the fields a sparse mirror node `post` entry sets; every unchanged field arrives as null.
 */
const toChangedEntityTraceState = (accountTrace: IPrestatePostAccountTrace): ChangedEntityTraceState => {
  const state: ChangedEntityTraceState = {};

  if (accountTrace.balance !== null) {
    state.balance = accountTrace.balance;
  }

  if (accountTrace.nonce !== null) {
    state.nonce = accountTrace.nonce;
  }

  if (accountTrace.code !== null) {
    state.code = accountTrace.code;
  }

  if (accountTrace.storage !== null) {
    state.storage = accountTrace.storage;
  }

  return state;
};

const pickSlots = (storage: Record<string, string>, slots: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(storage).filter(([slot]) => slots.includes(slot)));

const omitZeroSlots = (storage: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(storage).filter(([, value]) => BigInt(value) !== BigInt(0)));

/**
 * Maps a mirror node diff mode response onto geth's `{ pre, post }` shape.
 *
 * The mirror node keeps every touched slot in `pre` and reports a slot written to zero in `post`. Geth keeps
 * only the slots that changed in `pre` and leaves zero-valued slots out of `post`, so a cleared slot shows in
 * `pre` alone. Accounts in `pre` without a `post` entry were deleted and keep their full state.
 *
 * @param response - The response of the mirror node prestate endpoint in diff mode.
 * @returns The changed accounts before the transaction, and only what changed after it.
 */
export const mapPrestateDiffResponse = (response: IPrestateResponse): PrestateDiffResult => {
  const pre = mapPrestateResponse(response);
  const post: Record<string, ChangedEntityTraceState> = {};

  for (const accountTrace of response?.post ?? []) {
    if (!accountTrace?.address) {
      continue;
    }

    const address = accountTrace.address.toLowerCase();
    const state = toChangedEntityTraceState(accountTrace);
    const changedSlots = Object.keys(state.storage ?? {});
    const preStorage = pre[address]?.storage;

    if (preStorage) {
      pre[address] = { ...pre[address], storage: pickSlots(preStorage, changedSlots) };
    }

    if (state.storage) {
      state.storage = omitZeroSlots(state.storage);
    }

    if (state.storage && Object.keys(state.storage).length === 0) {
      delete state.storage;
    }

    post[address] = state;
  }

  return { pre, post };
};

/**
 * Applies the geth prestateTracer options to a diff mode result.
 *
 * `disableCode` and `disableStorage` apply to both sides; empty accounts are dropped from `pre` only, as in geth.
 * Returns a new result, since the input is usually a cached one.
 *
 * @param diff - The full diff mode result.
 * @param config - The prestateTracer options.
 * @returns The diff with the options applied.
 */
export const applyPrestateDiffConfig = (
  diff: PrestateDiffResult,
  config: IPrestateTracerConfig = {},
): PrestateDiffResult => {
  const { disableCode, disableStorage } = config;

  const post: Record<string, ChangedEntityTraceState> = {};

  for (const [address, state] of Object.entries(diff.post)) {
    const trimmed: ChangedEntityTraceState = { ...state };

    if (disableCode) {
      delete trimmed.code;
    }

    if (disableStorage) {
      delete trimmed.storage;
    }

    post[address] = trimmed;
  }

  return { pre: applyPrestateTracerConfig(diff.pre, config), post };
};
