// SPDX-License-Identifier: Apache-2.0
import { IMethodRateLimit } from './IMethodRateLimit';

export interface IMethodRateLimitConfiguration {
  [method: string]: IMethodRateLimit;
}
