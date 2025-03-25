// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '../../../errors/JsonRpcError';
import { Log } from '../../../model';
import { RequestDetails } from '../../../types';
import { INewFilterParams } from '../../../types/requestParams';
export interface IFilterService {
  newFilter(params: INewFilterParams, requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  newBlockFilter(requestDetails: RequestDetails): Promise<string | JsonRpcError>;

  uninstallFilter(filterId: string, requestDetails: RequestDetails): Promise<boolean>;

  newPendingTransactionFilter(requestDetails: RequestDetails): JsonRpcError;

  getFilterLogs(filterId: string, requestDetails: RequestDetails): Promise<any>;

  getFilterChanges(filterId: string, requestDetails: RequestDetails): Promise<string[] | Log[] | JsonRpcError>;
}
