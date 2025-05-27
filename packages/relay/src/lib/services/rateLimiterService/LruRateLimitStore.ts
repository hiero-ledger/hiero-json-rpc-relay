// SPDX-License-Identifier: Apache-2.0

import { IRateLimitStore } from '../../types/IRateLimitStore';

interface DatabaseEntry {
  reset: number;
  methodInfo: any;
}

interface MethodDatabase {
  methodName: string;
  remaining: number;
  total: number;
}

export class LruRateLimitStore implements IRateLimitStore {
  private database: any;
  private duration: number;

  constructor(duration: number) {
    this.database = Object.create(null);
    this.duration = duration;
  }

  async incrementAndCheck(key: string, limit: number, duration: number): Promise<boolean> {
    // The key is constructed as `ratelimit:${ip}:${method}` in the RateLimiteService class.
    // We need to parse out the ip and method from the key.
    const parts = key.split(':');
    if (parts.length !== 3) {
      // Handle error: invalid key format
      // For now, let's assume the key is always in the correct format
      // and this is a placeholder for actual error handling.
      console.error('Invalid key format for LruRateLimitStore');
      return true; // Or some other appropriate error response
    }
    const ip = parts[1];
    const methodName = parts[2];

    this.precheck(ip, methodName, limit);
    if (!this.shouldReset(ip)) {
      if (this.checkRemaining(ip, methodName)) {
        this.decreaseRemaining(ip, methodName);
        return false; // Not rate-limited
      }
      return true; // Rate-limited
    } else {
      this.reset(ip, methodName, limit);
      this.decreaseRemaining(ip, methodName);
      return false; // Not rate-limited
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
