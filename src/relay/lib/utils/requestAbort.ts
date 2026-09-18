// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError, predefined } from '../errors/JsonRpcError';
import { type RequestDetails } from '../types/RequestDetails';

/**
 * The part of {@link RequestDetails}.
 */
type CancellableRequest = Pick<RequestDetails, 'abortSignal'>;

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
 * Throws {@link predefined.REQUEST_ABORTED} when the caller has abandoned the request.
 *
 * @param requestDetails - The request metadata to check.
 */
export function throwIfRequestAborted(requestDetails?: CancellableRequest): void {
  if (isRequestAborted(requestDetails)) {
    throw predefined.REQUEST_ABORTED;
  }
}

/**
 * Reports whether an error is the cancellation raised when the caller abandons the request.
 *
 * @param error - The value thrown or returned by the failed operation.
 * @returns `true` when the error signals that the request was aborted by its caller.
 */
export function isRequestAbortedError(error: unknown): boolean {
  return error instanceof JsonRpcError && error.code === predefined.REQUEST_ABORTED.code;
}
