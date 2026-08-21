// SPDX-License-Identifier: Apache-2.0

import { type Log } from '../../../model';
import { type IContractLogsResultsParams, type RequestDetails } from '../../../types';
import { type LogTopic } from '../../../types/requestParams';
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
    const EMPTY_RESPONSE = [];
    const params: IContractLogsResultsParams = {};
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
