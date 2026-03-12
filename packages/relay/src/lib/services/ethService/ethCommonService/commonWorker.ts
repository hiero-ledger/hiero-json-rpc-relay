// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import pino from 'pino';

import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import { CacheClientFactory } from '../../../factories/cacheClientFactory';
import { RegistryFactory } from '../../../factories/registryFactory';
import { RequestDetails } from '../../../types';
import { wrapError } from '../../workersService/WorkersErrorUtils';
import { CommonService } from './CommonService';

/**
 * Worker threads run in separate V8 Isolates with isolated memory heaps.
 * Initialization is deferred to the first task invocation so that worker
 * threads that are spawned but never receive work incur near-zero memory overhead.
 */
interface WorkerContext {
  commonService: CommonService;
}

let _ctx: WorkerContext | undefined;

/** Lazily initializes and returns the shared worker context. */
function ctx(): WorkerContext {
  if (!_ctx) {
    const logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' });
    const register = RegistryFactory.getInstance();
    const cacheService = CacheClientFactory.create(logger, register);
    const mirrorNodeClient = new MirrorNodeClient(ConfigService.get('MIRROR_NODE_URL'), logger, register, cacheService);
    const commonService = new CommonService(mirrorNodeClient, logger, cacheService);
    _ctx = { commonService };
  }
  return _ctx!;
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
    const EMPTY_RESPONSE = [];
    const params: any = {};
    const sliceCountWrapper = { value: 1 };

    if (blockHash) {
      if (
        !(await ctx().commonService.validateBlockHashAndAddTimestampToParams(
          params,
          blockHash,
          requestDetails,
          sliceCountWrapper,
        ))
      ) {
        return EMPTY_RESPONSE;
      }
    } else if (
      !(await ctx().commonService.validateBlockRangeAndAddTimestampToParams(
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

    ctx().commonService.addTopicsToParams(params, topics);

    return await ctx().commonService.getLogsWithParams(address, params, requestDetails, sliceCountWrapper.value);
  } catch (e: unknown) {
    throw wrapError(e);
  }
}
