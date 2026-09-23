// SPDX-License-Identifier: Apache-2.0

/**
 * A block number (hex-encoded quantity) or a named block tag accepted by the log-filter methods.
 */
export type BlockNumberOrTag = 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized' | string;

/**
 * A single entry of a log-filter `topics` array: a topic hash, an array of hashes (OR-match), or `null`.
 */
export type LogTopic = string | string[] | null;

/**
 * Interface representing parameters for the getLogs method.
 * Used to filter and retrieve logs from the blockchain.
 *
 * @param blockHash - Hash of the block to get logs from. If null, logs are not filtered by block hash.
 * @param fromBlock - The block number or tag to start fetching logs from.
 * @param toBlock - The block number or tag to stop fetching logs at.
 * @param address - Contract address or list of addresses to filter logs by. If null, logs are not filtered by address.
 * @param topics - Array of topics to filter logs by. If null, logs are not filtered by topics.
 */
export interface IGetLogsParams {
  blockHash: string | null;
  fromBlock: BlockNumberOrTag;
  toBlock: BlockNumberOrTag;
  address: string | string[] | null;
  topics: LogTopic[] | null;
}

/**
 * Interface representing parameters for the eth_newFilter method.
 * Used to create a filter object to notify when the state changes.
 *
 * @param fromBlock - The block number or tag to start filtering from. Defaults to 'latest'.
 * @param toBlock - The block number or tag to stop filtering at. Defaults to 'latest'.
 * @param address - Contract address or list of addresses to filter by. Optional.
 * @param topics - Array of topics to filter by. Optional.
 */
export interface INewFilterParams {
  fromBlock?: BlockNumberOrTag;
  toBlock?: BlockNumberOrTag;
  address?: string | string[];
  topics?: LogTopic[];
}

/**
 * Storage slots for a single account, keyed by 32-byte slot.
 * Both keys and values are 0x-prefixed 64-digit hex.
 */
export type AccountStorage = Record<string, string>;

/**
 * A single account's overrides as sent by Ethereum tooling.
 * `state` replaces all storage; `stateDiff` patches individual slots. They are mutually exclusive.
 */
export interface IAccountOverride {
  balance?: string;
  nonce?: string;
  code?: string;
  state?: AccountStorage;
  stateDiff?: AccountStorage;
  // Supported by geth, unsupported by the mirror node. Declared so the validator can reject it.
  movePrecompileToAddress?: string;
}

/**
 * The optional third parameter of `eth_call` and `eth_estimateGas`, keyed by 20-byte address.
 */
export type StateOverrideSet = Record<string, IAccountOverride>;
