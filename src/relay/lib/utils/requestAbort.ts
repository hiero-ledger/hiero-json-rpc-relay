// SPDX-License-Identifier: Apache-2.0

import { type RequestDetails } from '../types/RequestDetails';

/**
 * The name the platform gives to a cancellation raised through an `AbortSignal`.
 */
const ABORT_ERROR_NAME = 'AbortError';

/**
 * The name Axios gives to the rejection of a request cancelled through its `signal` option.
 */
const AXIOS_CANCELED_ERROR_NAME = 'CanceledError';

/**
 * The part of {@link RequestDetails}.
 */
type CancellableRequest = Pick<RequestDetails, 'abortSignal'>;

/**
 * Builds the reason an {@link AbortController} is aborted with, so that awaiting callers unwind with the
 * platform's native abort error instead of a relay-specific one.
 *
 * @param message - The human readable explanation of why the request was abandoned.
 * @returns The `AbortError` to pass to `AbortController.abort()`.
 */
export function requestAbortReason(message: string): DOMException {
  return new DOMException(message, ABORT_ERROR_NAME);
}

/**
 * Returns the cancellation signal of a request, if it carries one.
 *
 * @param requestDetails - The request metadata to read the signal from.
 * @returns The request-scoped `AbortSignal`, or `undefined` when the request is not cancellable.
 */
export function getRequestAbortSignal(requestDetails?: CancellableRequest): AbortSignal | undefined {
  return requestDetails?.abortSignal;
}

/**
 * Reports whether the caller has abandoned the request.
 *
 * @param requestDetails - The request metadata to check.
 * @returns `true` when the request carries a signal that has already been aborted.
 */
export function isRequestAborted(requestDetails?: CancellableRequest): boolean {
  return getRequestAbortSignal(requestDetails)?.aborted === true;
}

/**
 * Unwinds the current operation when the caller has abandoned the request, by throwing the signal's own
 * abort reason. This mirrors how a cancelled `context.Context` unwinds a request in other Ethereum clients:
 * the work stops, and no client-facing error is invented for a response that can no longer be delivered.
 *
 * @param requestDetails - The request metadata to check.
 */
export function throwIfRequestAborted(requestDetails?: CancellableRequest): void {
  getRequestAbortSignal(requestDetails)?.throwIfAborted();
}

/**
 * Reports whether an error is the cancellation raised when the caller abandons the request.
 *
 * @param error - The value thrown or returned by the failed operation.
 * @returns `true` for the native `AbortError`, or for the `CanceledError` Axios raises when an in-flight
 *          request is aborted.
 */
export function isRequestAbortedError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === ABORT_ERROR_NAME || name === AXIOS_CANCELED_ERROR_NAME;
}
