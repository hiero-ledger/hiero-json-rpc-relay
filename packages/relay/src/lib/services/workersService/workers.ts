// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from '../../types';
import { getBlock, getBlockReceipts, getRawReceipts } from '../ethService/blockService/blockWorker';
import { getLogs } from '../ethService/ethCommonService/commonWorker';

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

type WorkerTask = GetLogsTask | GetBlockTask | GetBlockReceiptsTask | GetRawReceiptsTask;

/**
 * Main worker export - handles different task types.
 * This function is called by Piscina with the task data.
 */
export default async function handleTask(task: WorkerTask): Promise<any> {
  switch (task.type) {
    case 'getBlock':
      return await getBlock(task.blockHashOrNumber, task.showDetails, task.requestDetails, task.chain);
    case 'getBlockReceipts':
      return await getBlockReceipts(task.blockHashOrBlockNumber, task.requestDetails);
    case 'getRawReceipts':
      return await getRawReceipts(task.blockHashOrBlockNumber, task.requestDetails);
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
