// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from './RequestDetails';

/**
 * Supported rate limit store types.
 */
export enum RateLimitStoreType {
  REDIS = 'REDIS',
  LRU = 'LRU',
}

/**
 * Represents a type-safe rate limit key with IP and method components.
 */
export class RateLimitKey {
  private static readonly PREFIX = 'ratelimit';

  constructor(
    public readonly ip: string,
    public readonly method: string,
  ) {}

  /**
   * Converts the key to its string representation.
   * @returns The string key in format 'ratelimit:{ip}:{method}'.
   */
  toString(): string {
    return `${RateLimitKey.PREFIX}:${this.ip}:${this.method}`;
  }
}

/**
 * Represents the rate limit for a specific method.
 */
export interface MethodRateLimit {
  /**
   * The total number of allowed requests for the method.
   */
  total: number;
}

/**
 * Configuration for method-specific rate limits.
 * Maps method names to their respective rate limits.
 */
export interface MethodRateLimitConfiguration {
  /**
   * The method name as the key and its rate limit configuration.
   */
  [method: string]: MethodRateLimit;
}

/**
 * Interface for a rate limit store that can increment and check request counts.
 */
export interface RateLimitStore {
  /**
   * Increments the request count for a given key and checks if it exceeds the limit.
   *
   * @param key - The unique key representing the request context.
   * @param limit - The maximum number of allowed requests.
   * @param requestDetails - Request details for logging and tracing.
   * @returns A promise that resolves to true if the request count exceeds the limit, otherwise false.
   */
  incrementAndCheck(key: RateLimitKey, limit: number, requestDetails: RequestDetails): Promise<boolean>;
}
