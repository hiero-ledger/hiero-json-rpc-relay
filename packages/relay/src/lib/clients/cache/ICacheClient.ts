// SPDX-License-Identifier: Apache-2.0

export interface ICacheClient {
  keys(pattern: string, callingMethod: string): Promise<string[]>;
  get(key: string, callingMethod: string): Promise<any>;
  set(key: string, value: any, callingMethod: string, ttl?: number): Promise<void>;
  multiSet(keyValuePairs: Record<string, any>, callingMethod: string): Promise<void>;
  pipelineSet(keyValuePairs: Record<string, any>, callingMethod: string, ttl?: number | undefined): Promise<void>;
  delete(key: string, callingMethod: string): Promise<void>;
  clear(): Promise<void>;
}
