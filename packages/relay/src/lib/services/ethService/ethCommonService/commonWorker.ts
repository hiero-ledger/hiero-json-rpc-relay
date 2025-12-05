// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import pino from 'pino';
import { Registry } from 'prom-client';

import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import { RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import { CommonService } from './CommonService';

const logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' });
const register = new Registry();
const cacheService = new CacheService(logger, register);
const mirrorNodeClient = new MirrorNodeClient(ConfigService.get('MIRROR_NODE_URL'), logger, register, cacheService);

interface GetLogsTask {
  type: 'getLogs';
  blockHash: string | null;
  fromBlock: string | 'latest';
  toBlock: string | 'latest';
  address: string | string[] | null;
  topics: any[] | null;
  requestDetails: RequestDetails;
}

type WorkerTask = GetLogsTask;

async function getLogs(
  blockHash: string | null,
  fromBlock: string | 'latest',
  toBlock: string | 'latest',
  address: string | string[] | null,
  topics: any[] | null,
  requestDetails: RequestDetails,
) {
  const commonService = new CommonService(mirrorNodeClient, logger, cacheService);
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

  return commonService.getLogsWithParams(address, params, requestDetails);
}

export default async function handleTask(task: WorkerTask): Promise<any> {
  switch (task.type) {
    case 'getLogs':
      return await getLogs(
        task.blockHash,
        task.fromBlock,
        task.toBlock,
        task.address,
        task.topics,
        task.requestDetails,
      );
    default:
      throw new Error(`Unknown task type: ${(task as any).type}`);
  }
}
