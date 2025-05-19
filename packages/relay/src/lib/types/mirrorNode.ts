// SPDX-License-Identifier: Apache-2.0

export interface IAccountInfo {
  /**
   * Account ID string in the form `shard.realm.num`
   */
  account: string;
  /**
   * RFC4648 no-padding base32 encoded string of the account's alias.
   */
  alias: string;
  balance?: IAccountBalance;
  deleted?: boolean;
  ethereum_nonce?: number;
  evm_address?: string;
  memo?: string;
}

export interface IAccountBalance {
  balance: number;
  timestamp?: string;
  tokens?: { token_id: string; balance: number }[];
}

export interface ILimitOrderParams {
  limit?: number;
  order?: string;
}

export interface IContractResultsParams {
  blockHash?: string;
  blockNumber?: number;
  from?: string;
  internal?: boolean;
  timestamp?: string | string[];
  transactionIndex?: number;
}

export interface IContractLogsResultsParams {
  'transaction.hash': string;
  index?: number;
  timestamp?: string | string[];
  topic0?: string | string[];
  topic1?: string | string[];
  topic2?: string | string[];
  topic3?: string | string[];
}

export interface IContractCallRequest {
  block?: string;
  estimate?: boolean;
  from?: string;
  to?: string | null;
  gas?: number | string;
  gasPrice?: number | string;
  value?: number | string | null;
  data?: string | null;
  input?: string;
}

export interface IContractCallResponse {
  result?: string;
  errorMessage?: string;
  statusCode?: number;
  _status?: {
    messages: Array<{ message: string; detail?: string; data?: string }>;
  };
}

export interface IContractResult {
  type: string;
  entity: {
    runtime_bytecode: string;
    created_timestamp: string;
    [key: string]: any;
  };
}

export interface IAssessedCustomFee {
  amount: number;
  collector_account_id: string;
  effective_payer_account_ids: string[];
  token_id: string;
}

export interface INftTransfer {
  is_approval: boolean;
  receiver_account_id: string;
  sender_account_id: string;
  serial_number: number;
  token_id: string;
}

export interface IStakingRewardTransfer {
  account: number;
  amount: number;
}

export interface ITokenTransfer {
  token_id: string;
  account: string;
  amount: number;
  is_approval: boolean;
}

export interface ITransfer {
  account: string;
  amount: number;
  is_approval: boolean;
}

export interface IMirrorNodeTransactionRecord {
  assessed_custom_fees: IAssessedCustomFee[];
  bytes: string | null;
  charged_tx_fee: number;
  consensus_timestamp: string;
  entity_id: string;
  max_fee: number;
  memo_base64: string | null;
  name: string;
  nft_transfers: INftTransfer[];
  node: string;
  nonce: number;
  parent_consensus_timestamp: string;
  result: string;
  scheduled: boolean;
  staking_reward_transfers: IStakingRewardTransfer[];
  transaction_hash: string;
  transaction_id: string;
  token_transfers: ITokenTransfer[];
  transfers: ITransfer[];
  valid_duration_seconds: number;
  valid_start_timestamp: string;
}
interface ITimestamp {
  from: string;
  to: string;
}

export interface LatestBlockNumberTimestamp {
  blockNumber: string | null;
  timeStampTo: string;
}

export interface MirrorNodeBlock {
  count: number;
  gas_used: number;
  hapi_version: string;
  hash: string;
  logs_bloom: string;
  name: string;
  number: number;
  previous_hash: string;
  size: number;
  timestamp: ITimestamp;
}

export class MirrorNodeTransactionRecord {
  public readonly assessed_custom_fees: IAssessedCustomFee[];
  public readonly bytes: string | null;
  public readonly charged_tx_fee: number;
  public readonly consensus_timestamp: string;
  public readonly entity_id: string;
  public readonly max_fee: number;
  public readonly memo_base64: string | null;
  public readonly name: string;
  public readonly nft_transfers: INftTransfer[];
  public readonly node: string;
  public readonly nonce: number;
  public readonly parent_consensus_timestamp: string;
  public readonly result: string;
  public readonly scheduled: boolean;
  public readonly staking_reward_transfers: IStakingRewardTransfer[];
  public readonly transaction_hash: string;
  public readonly transaction_id: string;
  public readonly token_transfers: ITokenTransfer[];
  public readonly transfers: ITransfer[];
  public readonly valid_duration_seconds: number;
  public readonly valid_start_timestamp: string;

  constructor(transactionRecord: IMirrorNodeTransactionRecord) {
    this.assessed_custom_fees = transactionRecord.assessed_custom_fees;
    this.bytes = transactionRecord.bytes;
    this.charged_tx_fee = transactionRecord.charged_tx_fee;
    this.consensus_timestamp = transactionRecord.consensus_timestamp;
    this.entity_id = transactionRecord.entity_id;
    this.max_fee = transactionRecord.max_fee;
    this.memo_base64 = transactionRecord.memo_base64;
    this.name = transactionRecord.name;
    this.nft_transfers = transactionRecord.nft_transfers;
    this.node = transactionRecord.node;
    this.nonce = transactionRecord.nonce;
    this.parent_consensus_timestamp = transactionRecord.parent_consensus_timestamp;
    this.result = transactionRecord.result;
    this.scheduled = transactionRecord.scheduled;
    this.staking_reward_transfers = transactionRecord.staking_reward_transfers;
    this.transaction_hash = transactionRecord.transaction_hash;
    this.transaction_id = transactionRecord.transaction_id;
    this.token_transfers = transactionRecord.token_transfers;
    this.transfers = transactionRecord.transfers;
    this.valid_duration_seconds = transactionRecord.valid_duration_seconds;
    this.valid_start_timestamp = transactionRecord.valid_start_timestamp;
  }
}

/**
 * Represents the result of a contract call or transaction as returned by the Hedera Mirror Node.
 */
export interface MirrorNodeContractResult {
  /** The address involved in the contract call. */
  address: string;
  /** The amount of hbars or tokens transferred. */
  amount: number;
  /** The bloom filter for the logs generated by the contract execution. */
  bloom: string;
  /** The raw result of the contract call. */
  call_result: string;
  /** The unique identifier of the contract. */
  contract_id: string;
  /** List of contract IDs created during the transaction. */
  created_contract_ids: string[];
  /** The error message if the contract execution failed, otherwise null. */
  error_message: string | null;
  /** The address that initiated the contract call. */
  from: string;
  /** The input parameters for the contract function call, encoded as a hex string. */
  function_parameters: string;
  /** The total amount of gas consumed during execution. */
  gas_consumed: number;
  /** The maximum amount of gas allowed for the transaction. */
  gas_limit: number;
  /** The actual amount of gas used by the transaction. */
  gas_used: number;
  /** The consensus timestamp of the transaction. */
  timestamp: string;
  /** The address of the contract being called. */
  to: string;
  /** The transaction hash. */
  hash: string;
  /** The hash of the block containing the transaction. */
  block_hash: string;
  /** The block number containing the transaction. */
  block_number: number;
  /** The result of the contract execution, typically as a hex string. */
  result: string;
  /** The index of the transaction within the block. */
  transaction_index: number;
  /** The status of the transaction (e.g., "SUCCESS", "FAIL"). */
  status: string;
  /** The failed contract init code, if applicable, otherwise null. */
  failed_initcode: string | null;
  /** The access list for EIP-2930 transactions. */
  access_list: string;
  /** The total gas used in the block. */
  block_gas_used: number;
  /** The chain ID of the network. */
  chain_id: string;
  /** The gas price used for the transaction. */
  gas_price: string;
  /** The maximum fee per gas for EIP-1559 transactions. */
  max_fee_per_gas: string;
  /** The maximum priority fee per gas for EIP-1559 transactions. */
  max_priority_fee_per_gas: string;
  /** The ECDSA signature r value. */
  r: string;
  /** The ECDSA signature s value. */
  s: string;
  /** The transaction type (e.g., 0 for legacy, 2 for EIP-1559). */
  type: number;
  /** The ECDSA signature recovery id. */
  v: number;
  /** The account nonce for the transaction. */
  nonce: number;
}

/**
 * Represents an action performed by a contract on the Hedera Mirror Node.
 */
export interface ContractAction {
  /** The depth of the call in the call stack. */
  call_depth: number;
  /** The type of operation performed (e.g., 'CALL'). */
  call_operation_type: 'CALL' | string;
  /** The type of call (e.g., 'CALL'). */
  call_type: 'CALL' | string;
  /** The Hedera account or contract ID of the caller (e.g., '0.0.2661815'). */
  caller: string;
  /** The type of the caller, either 'ACCOUNT', 'CONTRACT', or another string. */
  caller_type: 'ACCOUNT' | 'CONTRACT' | string;
  /** The hexadecimal address of the sender. */
  from: string;
  /** The amount of gas provided for the call. */
  gas: number;
  /** The amount of gas actually used during the call. */
  gas_used: number;
  /** The index of the action within the transaction. */
  index: number;
  /** The hex-encoded input data for the call. */
  input: string;
  /** The Hedera account or contract ID of the recipient (e.g., '0.0.5950145'). */
  recipient: string;
  /** The type of the recipient, either 'ACCOUNT', 'CONTRACT', or another string. */
  recipient_type: 'ACCOUNT' | 'CONTRACT' | string;
  /** The result data of the call, typically hex-encoded. */
  result_data: string;
  /** The type of result data (e.g., 'OUTPUT'). */
  result_data_type: 'OUTPUT' | string;
  /** The timestamp of the action, as a string. */
  timestamp: string;
  /** The hexadecimal address of the recipient. */
  to: string;
  /** The value transferred in the call. */
  value: number;
}
