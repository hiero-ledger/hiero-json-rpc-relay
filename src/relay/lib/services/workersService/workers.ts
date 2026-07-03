// SPDX-License-Identifier: Apache-2.0

import { type RequestDetails } from '../../types';
import { getBalance } from '../ethService/accountService/accountWorker';
import { getBlock, getBlockReceipts, getRawReceipts } from '../ethService/blockService/blockWorker';
import { getLogs } from '../ethService/ethCommonService/commonWorker';
import { getWorkerContext, type WorkerContext } from './workerContext';

interface GetBlockTask {
  type: 'getBlock';
  blockHashOrNumber: string;
  showDetails: boolean;
  requestDetails: RequestDetails;
  chain: string;
}

interface GetBlockReceiptsTask {
  type: 'getBlockReceipts';
  blockHashOrBlockNumber: string;
  requestDetails: RequestDetails;
}

interface GetLogsTask {
  type: 'getLogs';
  blockHash: string | null;
  fromBlock: string | 'latest';
  toBlock: string | 'latest';
  address: string | string[] | null;
  topics: any[] | null;
  requestDetails: RequestDetails;
}

interface GetRawReceiptsTask {
  type: 'getRawReceipts';
  blockHashOrBlockNumber: string;
  requestDetails: RequestDetails;
}

interface GetBalanceTask {
  type: 'getBalance';
  account: string;
  blockNumberOrTagOrHash: string;
  requestDetails: RequestDetails;
}

export type WorkerTask = GetLogsTask | GetBlockTask | GetBlockReceiptsTask | GetRawReceiptsTask | GetBalanceTask;

/**
 * Dispatches a worker task to the appropriate handler function.
 *
 * Invoked either by Piscina on a dedicated worker thread, or directly on the main
 * thread when {@link WORKERS_POOL_ENABLED} is `false` (local execution mode).
 *
 * @param task - Discriminated-union descriptor for the task to execute.
 * @param ctx - The shared worker context providing the clients and services
 * @returns A promise that resolves to the handler's result.
 * @throws {Error} If `task.type` does not match any known task variant.
 */
export default async function handleTask(task: WorkerTask, ctx?: WorkerContext): Promise<any> {
  // On a worker thread Piscina invokes this with no ctx; fall back to the shared per-thread cached context.
  if (!ctx) {
    ctx = getWorkerContext();
  }

  switch (task.type) {
    case 'getBlock':
      return await getBlock(ctx, task.blockHashOrNumber, task.showDetails, task.requestDetails, task.chain);
    case 'getBlockReceipts':
      return await getBlockReceipts(ctx, task.blockHashOrBlockNumber, task.requestDetails);
    case 'getRawReceipts':
      return await getRawReceipts(ctx, task.blockHashOrBlockNumber, task.requestDetails);
    case 'getLogs':
      return await getLogs(
        ctx,
        task.blockHash,
        task.fromBlock,
        task.toBlock,
        task.address,
        task.topics,
        task.requestDetails,
      );
    case 'getBalance':
      return await getBalance(ctx, task.account, task.blockNumberOrTagOrHash, task.requestDetails);

    default:
      throw new Error(`Unknown task type: ${(task as any).type}`);
  }
}
