// SPDX-License-Identifier: Apache-2.0
export interface Transaction {
  to?: string | null;
  from?: string;
  nonce?: number;
  gasLimit?: string | number;
  gasPrice?: string | number;
  data?: string;
  value?: string | number;
  chainId?: number;
  type?: number;
  maxPriorityFeePerGas?: string | number;
  maxFeePerGas?: string | number;
}

export interface TransactionResponse {
  transactionHash: string;
  blockHash: string;
  transactionIndex: number;
  blockNumber: number;
  contractAddress: string | null;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: any[];
}

export interface JsonRpcResponse {
  id: number | string;
  jsonrpc: string;
  result: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface FileContent {
  request: string;
  response: string;
  wildcards?: string[];
}

export interface ErrorResponse {
  [key: string]: unknown;
  error: Record<string, unknown>;
}

export interface Schema {
  [key: string]: unknown;
  pattern?: string;
}

export interface Method {
  name: string;
  result?: {
    schema: Schema;
  };
}

export interface TestCase {
  request: string;
  response: string;
  status?: number;
}

export interface TestCases {
  [testName: string]: TestCase;
}

export interface UpdateParamFunction {
  (testName: string, request: JsonRpcRequest): JsonRpcRequest;
}
