// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '../../../../../config-service/services';
import { type ILogsSizeLimits } from '../../../clients/mirrorNodeClient';
import { predefined } from '../../../errors/JsonRpcError';
import { type Log } from '../../../model';
import { type IContractLogsResultsParams, RequestDetails } from '../../../types';
import { type LogTopic } from '../../../types/requestParams';
import { assertAddressCountWithinLimit } from '../../../utils/addressLimit';
import { ResponseSizeBudget } from '../../../utils/responseSizeBudget';
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
  strictBlockRange: boolean = false,
): Promise<Log[]> {
  const { commonService } = ctx;
  try {
    // Re-check the cap inside the worker: the worker is a second entry point, so it must not trust the caller.
    assertAddressCountWithinLimit(address);

    const EMPTY_RESPONSE: Log[] = [];
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
        strictBlockRange,
      ))
    ) {
      return EMPTY_RESPONSE;
    }

    commonService.addTopicsToParams(params, topics);

    const call = createLogsCallLimits(requestDetails);
    try {
      return await commonService.getLogsWithParams(
        address,
        params,
        call.requestDetails,
        sliceCountWrapper.value,
        call.limits,
      );
    } finally {
      call.dispose();
    }
  } catch (e: unknown) {
    throw wrapError(e);
  }
}

/**
 * Creates the size limits of one `eth_getLogs` call: a byte budget shared by all of its timestamp slices and
 * addresses, and an `AbortController` that stops all of its Mirror Node requests once the budget is exceeded.
 *
 * @param requestDetails - The details of the request; its abort signal, if any, also aborts the call.
 * @returns The request details to fetch the logs with, the limits, and a function that releases the listener on
 *   the caller's abort signal.
 */
export function createLogsCallLimits(requestDetails: RequestDetails): {
  requestDetails: RequestDetails;
  limits: ILogsSizeLimits;
  dispose: () => void;
} {
  const controller = new AbortController();
  const callerSignal = requestDetails.abortSignal;
  let dispose = (): void => {};
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason);
  } else if (callerSignal) {
    const onCallerAbort = (): void => controller.abort(callerSignal.reason);
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    dispose = (): void => callerSignal.removeEventListener('abort', onCallerAbort);
  }

  const maxResponseSize: number = ConfigService.get('ETH_GET_LOGS_MAX_RESPONSE_SIZE');
  const budget: ResponseSizeBudget = new ResponseSizeBudget(
    maxResponseSize,
    () => predefined.LOGS_RESPONSE_SIZE_EXCEEDED(maxResponseSize),
    undefined,
    // the other slices and addresses unwind with the budget error as the abort reason
    () => controller.abort(budget.exceededError()),
  );

  return {
    requestDetails: new RequestDetails({
      requestId: requestDetails.requestId,
      ipAddress: requestDetails.ipAddress,
      connectionId: requestDetails.connectionId,
      abortSignal: controller.signal,
    }),
    limits: { budget, maxPageBytes: ConfigService.get('ETH_GET_LOGS_MAX_PAGE_SIZE') },
    dispose,
  };
}
