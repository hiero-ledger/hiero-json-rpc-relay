// SPDX-License-Identifier: Apache-2.0

export interface IRateLimitStore {
  incrementAndCheck(key: string, limit: number, duration: number): Promise<boolean>;
}
