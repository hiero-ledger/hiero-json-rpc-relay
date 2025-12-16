// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import pino from 'pino';
import { Registry } from 'prom-client';

import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import { CacheClientFactory } from '../../../factories/cacheClientFactory';
import { RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import { WorkersPool } from '../../workersService/WorkersPool';
import { CommonService } from './CommonService';

const logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' });
const register = new Registry();
const cacheService = new CacheService(CacheClientFactory.create(logger, register), register);
const mirrorNodeClient = new MirrorNodeClient(ConfigService.get('MIRROR_NODE_URL'), logger, register, cacheService);
const commonService = new CommonService(mirrorNodeClient, logger, cacheService);

export async function getLogs(
  blockHash: string | null,
  fromBlock: string | 'latest',
  toBlock: string | 'latest',
  address: string | string[] | null,
  topics: any[] | null,
  requestDetails: RequestDetails,
) {
  try {
    const EMPTY_RESPONSE = [];
    const params: any = {};

    if (blockHash) {
      if (!(await commonService.validateBlockHashAndAddTimestampToParams(params, blockHash, requestDetails))) {
        return EMPTY_RESPONSE;
      }
    } else if (
      !(await commonService.validateBlockRangeAndAddTimestampToParams(
        params,
        fromBlock,
        toBlock,
        requestDetails,
        address,
      ))
    ) {
      return EMPTY_RESPONSE;
    }

    commonService.addTopicsToParams(params, topics);

    return await commonService.getLogsWithParams(address, params, requestDetails);
  } catch (e: unknown) {
    throw WorkersPool.wrapError(e);
  }
}
