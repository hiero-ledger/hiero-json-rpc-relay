// SPDX-License-Identifier: Apache-2.0
import { ITimestamp } from '../services/ethService/ethCommonService/ITimestamp';

export interface IMirrorNodeBlock {
  count: number;
  gas_used: number;
  hapi_version: string;
  hash: string;
  logs_bloom: string;
  name: string;
  number: number;
  previous_hash: string;
  size: number;
  timestamp: ITimestamp;
}
