// SPDX-License-Identifier: Apache-2.0

import { type Log } from '../../../model';
import { type RequestDetails } from '../../../types';
import { type LogTopic } from '../../../types/requestParams';
import { assertAddressCountWithinLimit } from '../../../utils/addressLimit';
import { type IWorkerContext } from '../../workersService/workerContext';
import { wrapError } from '../../workersService/WorkersErrorUtils';

export async function getLogs(
  ctx: IWorkerContext,
  blockHash: string | null,
  fromBlock: string | 'latest',
  toBlock: string | 'latest',
  address: string | string[] | null,
  topics: LogTopic[] | null,
  requestDetails: RequestDetails,
): Promise<Log[]> {
  const { commonService } = ctx;
  try {
    // Re-check the cap inside the worker: the worker is a second entry point, so it must not trust the caller.
    assertAddressCountWithinLimit(address);

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
