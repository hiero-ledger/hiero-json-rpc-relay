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
