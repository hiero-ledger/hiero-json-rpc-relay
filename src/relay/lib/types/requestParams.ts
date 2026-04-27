// SPDX-License-Identifier: Apache-2.0

/**
 * Interface representing parameters for the getLogs method.
 * Used to filter and retrieve logs from the blockchain.
 *
 * @param blockHash - Hash of the block to get logs from. If null, logs are not filtered by block hash.
 * @param fromBlock - The block number or 'latest' to start fetching logs from.
 * @param toBlock - The block number or 'latest' to stop fetching logs at.
 * @param address - Contract address or list of addresses to filter logs by. If null, logs are not filtered by address.
 * @param topics - Array of topics to filter logs by. If null, logs are not filtered by topics.
 */
export interface IGetLogsParams {
  blockHash: string | null;
  fromBlock: string | 'latest';
  toBlock: string | 'latest';
  address: string | string[] | null;
  topics: any[] | null;
}

/**
 * Interface representing parameters for the eth_newFilter method.
 * Used to create a filter object to notify when the state changes.
 *
 * @param fromBlock - The block number or 'latest' to start filtering from. Defaults to 'latest'.
 * @param toBlock - The block number or 'latest' to stop filtering at. Defaults to 'latest'.
 * @param address - Contract address or list of addresses to filter by. Optional.
 * @param topics - Array of topics to filter by. Optional.
 */
export interface INewFilterParams {
  fromBlock?: string | 'latest';
  toBlock?: string | 'latest';
  address?: string | string[];
  topics?: any[];
}
