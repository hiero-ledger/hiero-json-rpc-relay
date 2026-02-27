// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import pino, { Logger } from 'pino';

import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import { CacheClientFactory } from '../../../factories/cacheClientFactory';
import { RegistryFactory } from '../../../factories/registryFactory';
import { RequestDetails } from '../../../types';
import { WorkersErrorUtils } from '../../workersService/WorkersErrorUtils';
import { CommonService } from './CommonService';

/**
 * Lazy-initialised worker-scoped service singletons.
 * Avoids duplicating main-thread instances when running in local bypass mode.
 */
let _logger: Logger;
let _mirrorNodeClient: MirrorNodeClient;
let _commonService: CommonService;

function ctx() {
  if (!_logger) {
    _logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' }) as Logger;
    const register = RegistryFactory.getInstance();
    const cacheService = CacheClientFactory.create(_logger, register);
    _mirrorNodeClient = new MirrorNodeClient(ConfigService.get('MIRROR_NODE_URL'), _logger, register, cacheService);
    _commonService = new CommonService(_mirrorNodeClient, _logger, cacheService);
  }
  return { commonService: _commonService };
}

export async function getLogs(
  blockHash: string | null,
  fromBlock: string | 'latest',
  toBlock: string | 'latest',
  address: string | string[] | null,
  topics: any[] | null,
  requestDetails: RequestDetails,
) {
  try {
    const { commonService } = ctx();
    const EMPTY_RESPONSE = [];
    const params: any = {};
    const sliceCountWrapper = { value: 1 };

    if (blockHash) {
      if (
        !(await commonService.validateBlockHashAndAddTimestampToParams(
          params,
          blockHash,
          requestDetails,
          sliceCountWrapper,
        ))
      ) {
        return EMPTY_RESPONSE;
      }
    } else if (
      !(await commonService.validateBlockRangeAndAddTimestampToParams(
        params,
        fromBlock,
        toBlock,
        requestDetails,
        address,
        sliceCountWrapper,
      ))
    ) {
      return EMPTY_RESPONSE;
    }

    commonService.addTopicsToParams(params, topics);

    return await commonService.getLogsWithParams(address, params, requestDetails, sliceCountWrapper.value);
  } catch (e: unknown) {
    throw WorkersErrorUtils.wrapError(e);
  }
}
