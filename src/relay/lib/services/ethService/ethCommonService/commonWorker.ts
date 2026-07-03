// SPDX-License-Identifier: Apache-2.0

import { type Log } from '../../../model';
import { type RequestDetails } from '../../../types';
import { type WorkerContext } from '../../workersService/workerContext';
import { wrapError } from '../../workersService/WorkersErrorUtils';

export async function getLogs(
  ctx: WorkerContext,
  blockHash: string | null,
  fromBlock: string | 'latest',
  toBlock: string | 'latest',
  address: string | string[] | null,
  topics: any[] | null,
  requestDetails: RequestDetails,
): Promise<Log[]> {
  const { commonService } = ctx;
  try {
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
    throw wrapError(e);
  }
}
