// SPDX-License-Identifier: Apache-2.0

import { RateLimitKey, RateLimitStore } from '../../types';

interface DatabaseEntry {
  reset: number;
  methodInfo: any;
}

interface MethodDatabase {
  methodName: string;
  remaining: number;
  total: number;
}

/**
 * LRU-based in-memory rate limit store.
 * Tracks request counts per IP and method within a time window.
 */
export class LruRateLimitStore implements RateLimitStore {
  private database: any;
  private duration: number;

  /**
   * Initializes the store with the specified duration window.
   * @param duration - Time window in milliseconds for rate limiting.
   */
  constructor(duration: number) {
    this.database = Object.create(null);
    this.duration = duration;
  }

  /**
   * Increments the request count for a given IP and method, checking if the limit is exceeded.
   * @param key - The rate limit key containing IP and method information.
   * @param limit - Maximum allowed requests in the current window.
   * @returns True if rate limit exceeded, false otherwise.
   */
  async incrementAndCheck(key: RateLimitKey, limit: number): Promise<boolean> {
    const { ip, method } = key;

    this.precheck(ip, method, limit);
    if (!this.shouldReset(ip)) {
      if (this.checkRemaining(ip, method)) {
        this.decreaseRemaining(ip, method);
        return false;
      }
      return true;
    } else {
      this.reset(ip, method, limit);
      this.decreaseRemaining(ip, method);
      return false;
    }
  }

  /**
   * Ensures the IP and method are initialized in the database.
   * @param ip - The IP address to check.
   * @param methodName - The method name to check.
   * @param total - The total number of allowed requests.
   */
  private precheck(ip: string, methodName: string, total: number): void {
    if (!this.checkIpExist(ip)) {
      this.setNewIp(ip);
    }

    if (!this.checkMethodExist(ip, methodName)) {
      this.setNewMethod(ip, methodName, total);
    }
  }

  /**
   * Initializes a new IP entry in the database.
   * @param ip - The IP address to initialize.
   */
  private setNewIp(ip: string): void {
    const entry: DatabaseEntry = {
      reset: Date.now() + this.duration,
      methodInfo: {},
    };
    this.database[ip] = entry;
  }

  /**
   * Initializes a new method entry for a given IP in the database.
   * @param ip - The IP address associated with the method.
   * @param methodName - The method name to initialize.
   * @param total - The total number of allowed requests.
   */
  private setNewMethod(ip: string, methodName: string, total: number): void {
    const entry: MethodDatabase = {
      methodName: methodName,
      remaining: total,
      total: total,
    };
    this.database[ip].methodInfo[methodName] = entry;
  }

  /**
   * Checks if an IP exists in the database.
   * @param ip - The IP address to check.
   * @returns True if the IP exists, false otherwise.
   */
  private checkIpExist(ip: string): boolean {
    return this.database[ip] !== undefined;
  }

  /**
   * Checks if a method exists for a given IP in the database.
   * @param ip - The IP address associated with the method.
   * @param method - The method name to check.
   * @returns True if the method exists, false otherwise.
   */
  private checkMethodExist(ip: string, method: string): boolean {
    return this.database[ip].methodInfo[method] !== undefined;
  }

  /**
   * Checks if there are remaining requests for a given IP and method.
   * @param ip - The IP address associated with the method.
   * @param methodName - The method name to check.
   * @returns True if there are remaining requests, false otherwise.
   */
  private checkRemaining(ip: string, methodName: string): boolean {
    return this.database[ip].methodInfo[methodName].remaining > 0;
  }

  /**
   * Determines if the rate limit should be reset for a given IP.
   * @param ip - The IP address to check.
   * @returns True if the rate limit should be reset, false otherwise.
   */
  private shouldReset(ip: string): boolean {
    return this.database[ip].reset < Date.now();
  }

  /**
   * Resets the rate limit for a given IP and method.
   * @param ip - The IP address associated with the method.
   * @param methodName - The method name to reset.
   * @param total - The total number of allowed requests.
   */
  private reset(ip: string, methodName: string, total: number): void {
    this.database[ip].reset = Date.now() + this.duration;
    for (const [keyMethod] of Object.entries(this.database[ip].methodInfo)) {
      this.database[ip].methodInfo[keyMethod].remaining = this.database[ip].methodInfo[keyMethod].total;
    }
    // Ensure the current method being checked is reset with the potentially new total (limit)
    this.database[ip].methodInfo[methodName].remaining = total;
    this.database[ip].methodInfo[methodName].total = total; // also update total if it changed
  }

  /**
   * Decreases the remaining request count for a given IP and method.
   * @param ip - The IP address associated with the method.
   * @param methodName - The method name to decrease the count for.
   */
  private decreaseRemaining(ip: string, methodName: string): void {
    const currentRemaining = this.database[ip].methodInfo[methodName].remaining;
    this.database[ip].methodInfo[methodName].remaining = currentRemaining > 0 ? currentRemaining - 1 : 0;
  }
}
