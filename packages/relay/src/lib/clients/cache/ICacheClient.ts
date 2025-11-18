// SPDX-License-Identifier: Apache-2.0

export interface ICacheClient {
  keys(pattern: string, callingMethod: string): Promise<string[]>;
  getAsync<T = any>(key: string, callingMethod: string): Promise<T>;
  set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void>;
  multiSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number | undefined): Promise<void>;
  delete(key: string, callingMethod: string): Promise<void>;
  clear(): Promise<void>;
  incrBy(key: string, amount: number, callingMethod: string): Promise<number>;
  rPush(key: string, value: any, callingMethod: string): Promise<number>;
  lRange<T = any>(key: string, start: number, end: number, callingMethod: string): Promise<T[]>;
}
