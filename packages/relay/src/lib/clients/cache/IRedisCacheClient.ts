// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from '../../types';
import type { ICacheClient } from './ICacheClient';

export interface IRedisCacheClient extends ICacheClient {
  disconnect: () => Promise<void>;
  incrBy(key: string, amount: number, callingMethod: string, requestDetails: RequestDetails): Promise<number>;
  rPush(key: string, value: any, callingMethod: string, requestDetails: RequestDetails): Promise<number>;
  lRange(
    key: string,
    start: number,
    end: number,
    callingMethod: string,
    requestDetails: RequestDetails,
  ): Promise<any[]>;
}
