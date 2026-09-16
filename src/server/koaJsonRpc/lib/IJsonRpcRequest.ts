// SPDX-License-Identifier: Apache-2.0

export interface IJsonRpcRequest {
  id: string | number | null;
  jsonrpc: '2.0';
  method: string;
  params?: unknown[];
}
