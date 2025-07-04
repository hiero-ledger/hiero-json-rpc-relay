// SPDX-License-Identifier: Apache-2.0
import { signTransaction } from '@hashgraph/json-rpc-relay/tests/helpers';
import axios from 'axios';

import { localNodeAccountPrivateKey, sendAccountAddress } from './constants';

export async function getTransactionCount(relayUrl: string) {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getTransactionCount',
    params: [sendAccountAddress, 'latest'],
  };

  const response = await sendRequestToRelay(relayUrl, request, false);

  return response.result;
}

export async function getLatestBlockHash(relayUrl: string) {
  const request = {
    jsonrpc: '2.0',
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
    id: 0,
  };

  const response = await sendRequestToRelay(relayUrl, request, false);

  return response.result.hash;
}

export async function sendRequestToRelay(relayUrl: string, request: any, needError: any) {
  try {
    const response = await axios.post(relayUrl, request);
    if (request.method === 'eth_sendRawTransaction') {
      await global.relay.pollForValidTransactionReceipt(response.data.result);
    }
    return response.data;
  } catch (error) {
    console.error(error);
    if (needError) {
      return error;
    } else {
      throw error;
    }
  }
}

export async function signAndSendRawTransaction(relayUrl: string, transaction: any) {
  transaction.nonce = parseInt(await getTransactionCount(relayUrl), 16);
  const signed = await signTransaction(transaction, localNodeAccountPrivateKey);
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendRawTransaction',
    params: [signed],
  };

  const response = await sendRequestToRelay(relayUrl, request, false);
  const requestTransactionReceipt = {
    id: 'test_id',
    jsonrpc: '2.0',
    method: 'eth_getTransactionReceipt',
    params: [response.result],
  };
  const transactionReceipt = await sendRequestToRelay(relayUrl, requestTransactionReceipt, false);
  return {
    transactionHash: response.result,
    blockHash: transactionReceipt.result.blockHash,
    transactionIndex: transactionReceipt.result.transactionIndex,
    blockNumber: transactionReceipt.result.blockNumber,
    contractAddress: transactionReceipt.result.contractAddress,
  };
}
