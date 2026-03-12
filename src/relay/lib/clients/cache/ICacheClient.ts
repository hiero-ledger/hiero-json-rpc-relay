// SPDX-License-Identifier: Apache-2.0

export interface ICacheClient {
  keys(pattern: string, callingMethod: string): Promise<string[]>;
  get(key: string, callingMethod: string): Promise<any>;
  set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void>;
  delete(key: string, callingMethod: string): Promise<void>;
  clear(): Promise<void>;
  incrBy(key: string, amount: number, callingMethod: string): Promise<number>;
  rPush(key: string, value: any, callingMethod: string): Promise<number>;
  lRange<T = any>(key: string, start: number, end: number, callingMethod: string): Promise<T[]>;

  /**
   * @deprecated Alias of `get`; consider removing. Left in place to avoid modifying the CacheService interface.
   */
  getAsync<T = any>(key: string, callingMethod: string): Promise<T>;
}
