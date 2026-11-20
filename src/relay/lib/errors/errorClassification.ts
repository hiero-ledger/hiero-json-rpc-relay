// SPDX-License-Identifier: Apache-2.0

/**
 * Who caused a failed JSON-RPC call: `client` for a bad or impossible request, `server` for a failure
 * of the relay or a service it depends on. Client errors are logged at `DEBUG`, server errors at `ERROR`.
 */
export type RpcErrorClass = 'client' | 'server';

const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * Whether an upstream HTTP status (e.g. from the Mirror Node) means the request itself was wrong.
 * A 4xx is a client error, except 429: being rate limited by the upstream is the relay's problem.
 * 5xx, timeouts and connection errors (mapped to 5xx codes) are server errors.
 *
 * @param status - The upstream HTTP status code.
 * @returns `true` for a 4xx other than 429.
 */
export function isClientHttpStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== HTTP_TOO_MANY_REQUESTS;
}

/**
 * Hedera statuses caused by the transaction or call the client sent, rather than by the relay or the network.
 * Every other status counts as a server error, so a status missing from this list is logged at `ERROR`.
 *
 * Statuses about the payer or the transaction fee (`INSUFFICIENT_PAYER_BALANCE`, `PAYER_ACCOUNT_NOT_FOUND`,
 * `INSUFFICIENT_TX_FEE`, …) are left out on purpose: the relay's operator account pays for the transactions
 * it submits, so they can just as well be the relay's problem.
 */
export const CLIENT_HEDERA_STATUSES: ReadonlySet<string> = new Set([
  'ACCOUNT_DELETED',
  'ACCOUNT_FROZEN_FOR_TOKEN',
  'ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN',
  'AMOUNT_EXCEEDS_ALLOWANCE',
  'CONTRACT_DELETED',
  'CONTRACT_EXECUTION_EXCEPTION',
  'CONTRACT_REVERT_EXECUTED',
  'INSUFFICIENT_ACCOUNT_BALANCE',
  'INSUFFICIENT_GAS',
  'INSUFFICIENT_TOKEN_BALANCE',
  'INVALID_ACCOUNT_ID',
  'INVALID_CONTRACT_ID',
  'INVALID_ETHEREUM_TRANSACTION',
  'INVALID_FULL_PREFIX_SIGNATURE_FOR_PRECOMPILE',
  'INVALID_SIGNATURE',
  'INVALID_SOLIDITY_ADDRESS',
  'INVALID_TOKEN_ID',
  'LOCAL_CALL_MODIFICATION_EXCEPTION',
  'MAX_CHILD_RECORDS_EXCEEDED',
  'MAX_GAS_LIMIT_EXCEEDED',
  'SPENDER_DOES_NOT_HAVE_ALLOWANCE',
  'TOKEN_IS_PAUSED',
  'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
  'TOKEN_WAS_DELETED',
  'TRANSACTION_OVERSIZE',
  'WRONG_NONCE',
]);

/**
 * Whether a Hedera status (e.g. `INVALID_SIGNATURE`) means the client's transaction or call was wrong.
 *
 * @param status - The Hedera status name, as `Status.toString()` returns it.
 * @returns `true` when the status is in {@link CLIENT_HEDERA_STATUSES}.
 */
export function isClientHederaStatus(status: string | undefined): boolean {
  return status !== undefined && CLIENT_HEDERA_STATUSES.has(status);
}
