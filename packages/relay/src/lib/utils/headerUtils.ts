// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from '../types';

export interface RetryableRequestDetails extends RequestDetails {
  retryEnabled?: boolean;
  retryCount?: number;
  shouldSetRetryCountHeader?: boolean;
}

export function isValidForRetry(requestDetails: any): requestDetails is RetryableRequestDetails {
  return !!(
    requestDetails &&
    typeof requestDetails === 'object' &&
    typeof requestDetails.requestId === 'string' &&
    requestDetails.requestId.length > 0
  );
}

export function isRetryEnabled(requestDetails: any): boolean {
  return !!(isValidForRetry(requestDetails) && requestDetails.retryEnabled === true);
}

export function findRequestDetailsInArgs(args: unknown[]): RetryableRequestDetails | undefined {
  for (const arg of args) {
    if (isValidForRetry(arg)) {
      return arg as RetryableRequestDetails;
    }
  }
  return undefined;
}

export function updateRetryCount(requestDetails: RetryableRequestDetails, retryCount: number): void {
  requestDetails.retryCount = retryCount;
}
