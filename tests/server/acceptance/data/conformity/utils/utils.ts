// SPDX-License-Identifier: Apache-2.0
import axios from 'axios';

import { signTransaction } from '../../../../../relay/helpers';
import { localNodeAccountPrivateKey, sendAccountAddress } from './constants';
import { type JsonRpcRequest, type JsonRpcResponse, type Transaction, type TransactionResponse } from './interfaces';

export async function getTransactionCount(relayUrl: string): Promise<string> {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getTransactionCount',
    params: [sendAccountAddress, 'latest'],
  };

  const response = await sendRequestToRelay(relayUrl, request as JsonRpcRequest, false);

  return response.result as string;
}

export async function getLatestBlockHash(relayUrl: string): Promise<string> {
  const request = {
    jsonrpc: '2.0',
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
    id: 0,
  };

  const response = await sendRequestToRelay(relayUrl, request as JsonRpcRequest, false);

  return (response.result as { hash: string }).hash;
}

export async function sendRequestToRelay(
  relayUrl: string,
  request: JsonRpcRequest,
  needError: boolean,
): Promise<JsonRpcResponse> {
  try {
    const response = await axios.post(relayUrl, request);
    if (request.method === 'eth_sendRawTransaction') {
      await global.relay.pollForValidTransactionReceipt(response.data.result);
    }
    return response.data;
  } catch (error) {
    console.error(error);
    if (needError) {
      if (axios.isAxiosError(error) && error.response?.data) {
        return error.response.data;
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'An unknown error occurred',
        },
      } as JsonRpcResponse;
    } else {
      throw error;
    }
  }
}

export async function signAndSendRawTransaction(
  relayUrl: string,
  transaction: Transaction,
): Promise<TransactionResponse> {
  transaction.nonce = parseInt(await getTransactionCount(relayUrl), 16);
  const signed = await signTransaction(transaction, localNodeAccountPrivateKey);
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendRawTransaction',
    params: [signed],
  };

  const response = await sendRequestToRelay(relayUrl, request as JsonRpcRequest, false);
  const requestTransactionReceipt = {
    id: 'test_id',
    jsonrpc: '2.0',
    method: 'eth_getTransactionReceipt',
    params: [response.result],
  };
  const transactionReceipt = await sendRequestToRelay(relayUrl, requestTransactionReceipt as JsonRpcRequest, false);
  const receipt = transactionReceipt.result as Omit<TransactionResponse, 'transactionHash'>;
  return {
    transactionHash: response.result as string,
    blockHash: receipt.blockHash,
    transactionIndex: receipt.transactionIndex,
    blockNumber: receipt.blockNumber,
    contractAddress: receipt.contractAddress,
  };
}
