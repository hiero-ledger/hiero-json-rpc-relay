// SPDX-License-Identifier: Apache-2.0

import { findRequestDetailsInArgs, isRetryEnabled, updateRetryCount } from '../utils/headerUtils';

interface RetryableOptions {
  maxRetries?: number;
  backoffTime?: number;
  backoffRate?: number;
  retryOn?: (error: any) => boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryableOptions> = {
  maxRetries: 3,
  backoffTime: 1000,
  backoffRate: 20,
  retryOn: (error: any) => {
    // TODO: Add actual error codes
    const retryableErrorCodes = ['THROTTLE', 'REJECTED'];

    if (error?.precheckCode) {
      return retryableErrorCodes.includes(error.precheckCode);
    }

    if (error?.message && typeof error.message === 'string') {
      return retryableErrorCodes.some((code) => error.message.includes(code));
    }

    return false;
  },
};

export function calculateBackoffDelay(attempt: number, baseDelay: number, backoffRate: number): number {
  return Math.floor(baseDelay * Math.pow(1 + backoffRate / 100, attempt));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A method decorator that adds automatic retry functionality to methods.
 * The decorator will retry failed method calls based on configurable conditions
 * including maximum retry attempts, exponential backoff, and error type filtering.
 *
 * Retries are only performed if:
 * 1. The method arguments contain a RequestDetails object with retryEnabled=true
 * 2. The error matches the retryOn predicate function
 * 3. The maximum retry limit has not been reached
 *
 * @param options - Configuration options for retry behavior
 * @returns A method decorator function that wraps the original method with retry logic
 *
 * @example
 *   @retryable({ maxRetries: 3, backoffTime: 1000, backoffRate: 20 })
 *   async sendTransaction(data: any, requestDetails: RequestDetails) {
 *     // Method implementation
 *   }
 */
export function retryable<T>(options: RetryableOptions = {}) {
  return function (target: any, context: ClassMethodDecoratorContext<T>) {
    const methodName = String(context.name);
    const config = { ...DEFAULT_RETRY_OPTIONS, ...options };

    return async function (this: T, ...args: unknown[]) {
      const requestDetails = findRequestDetailsInArgs(args);

      // If retry is not enabled, execute normally
      if (!requestDetails || !isRetryEnabled(requestDetails)) {
        return await (target as (...args: unknown[]) => unknown).apply(this, args);
      }

      let lastError: any;
      let attempt = 0;

      while (attempt <= config.maxRetries) {
        try {
          // Execute the original method
          const result = await (target as (...args: unknown[]) => unknown).apply(this, args);

          // If successful, update retry count and return result
          updateRetryCount(requestDetails, attempt);
          return result;
        } catch (error) {
          lastError = error;

          if (attempt >= config.maxRetries || !config.retryOn(error)) {
            updateRetryCount(requestDetails, attempt);
            throw error;
          }

          const delayMs = calculateBackoffDelay(attempt, config.backoffTime, config.backoffRate);
          const errorMessage =
            error && typeof error === 'object' && 'message' in error ? (error as Error).message : String(error);

          // TODO: Use logger
          console.warn(
            `${methodName} attempt ${attempt + 1} failed, retrying... ` +
              `(${config.maxRetries - attempt} attempts remaining) ` +
              `${requestDetails?.formattedRequestId || ''} ` +
              `Error: ${errorMessage}`,
          );

          await delay(delayMs);
          attempt++;
        }
      }

      // This should never be reached, but included for completeness
      updateRetryCount(requestDetails, attempt);
      throw lastError;
    };
  };
}
