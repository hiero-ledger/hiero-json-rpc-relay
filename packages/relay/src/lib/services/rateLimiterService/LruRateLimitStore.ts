// SPDX-License-Identifier: Apache-2.0

import { IRateLimitStore } from './IRateLimitStore';

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
export class LruRateLimitStore implements IRateLimitStore {
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
   * @param key - Composite key in format 'ratelimit:{ip}:{method}'.
   * @param limit - Maximum allowed requests in the current window.
   * @returns True if rate limit exceeded, false otherwise.
   */
  async incrementAndCheck(key: string, limit: number): Promise<boolean> {
    // The key is constructed as `ratelimit:${ip}:${method}` in the RateLimiteService class.
    // We need to parse out the ip and method from the key.
    const parts = key.split(':');
    if (parts.length !== 3) {
      console.error('Invalid key format for LruRateLimitStore');
      return true;
    }
    const ip = parts[1];
    const methodName = parts[2];

    this.precheck(ip, methodName, limit);
    if (!this.shouldReset(ip)) {
      if (this.checkRemaining(ip, methodName)) {
        this.decreaseRemaining(ip, methodName);
        return false;
      }
      return true;
    } else {
      this.reset(ip, methodName, limit);
      this.decreaseRemaining(ip, methodName);
      return false;
    }
  }

  private precheck(ip: string, methodName: string, total: number) {
    if (!this.checkIpExist(ip)) {
      this.setNewIp(ip);
    }

    if (!this.checkMethodExist(ip, methodName)) {
      this.setNewMethod(ip, methodName, total);
    }
  }

  private setNewIp(ip: string) {
    const entry: DatabaseEntry = {
      reset: Date.now() + this.duration,
      methodInfo: {},
    };
    this.database[ip] = entry;
  }

  private setNewMethod(ip: string, methodName: string, total: number) {
    const entry: MethodDatabase = {
      methodName: methodName,
      remaining: total,
      total: total,
    };
    this.database[ip].methodInfo[methodName] = entry;
  }

  private checkIpExist(ip: string): boolean {
    return this.database[ip] !== undefined;
  }

  private checkMethodExist(ip: string, method: string): boolean {
    return this.database[ip].methodInfo[method] !== undefined;
  }

  private checkRemaining(ip: string, methodName: string): boolean {
    return this.database[ip].methodInfo[methodName].remaining > 0;
  }

  private shouldReset(ip: string): boolean {
    return this.database[ip].reset < Date.now();
  }

  private reset(ip: string, methodName: string, total: number) {
    this.database[ip].reset = Date.now() + this.duration;
    for (const [keyMethod] of Object.entries(this.database[ip].methodInfo)) {
      this.database[ip].methodInfo[keyMethod].remaining = this.database[ip].methodInfo[keyMethod].total;
    }
    // Ensure the current method being checked is reset with the potentially new total (limit)
    this.database[ip].methodInfo[methodName].remaining = total;
    this.database[ip].methodInfo[methodName].total = total; // also update total if it changed
  }

  private decreaseRemaining(ip: string, methodName: string) {
    const currentRemaining = this.database[ip].methodInfo[methodName].remaining;
    this.database[ip].methodInfo[methodName].remaining = currentRemaining > 0 ? currentRemaining - 1 : 0;
  }
}
