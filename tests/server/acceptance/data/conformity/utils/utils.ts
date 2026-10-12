// SPDX-License-Identifier: Apache-2.0
import axios from 'axios';

import { numberTo0x, toHash32 } from '../../../../../../src/relay/formatters';
import { type MirrorNodeContractLog } from '../../../../../../src/relay/lib/types/mirrorNode';
import { signTransaction } from '../../../../../relay/helpers';
import { localNodeAccountPrivateKey, sendAccountAddress } from './constants';
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type SyntheticTransactionResponse,
  type Transaction,
  type TransactionResponse,
} from './interfaces';

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

/**
 * Polls the mirror node until the synthetic log for the given HTS token is indexed.
 * Throws on timeout so a setup race fails loudly instead of leaving the context undefined.
 */
export async function pollForSyntheticTransaction(
  tokenId: string,
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<SyntheticTransactionResponse> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await global.mirrorNode.get('/contracts/results/logs?order=desc&limit=25');
    const log: MirrorNodeContractLog | undefined = response?.logs?.find(
      (entry: MirrorNodeContractLog) => entry.contract_id === tokenId,
    );

    if (log) {
      return {
        transactionHash: toHash32(log.transaction_hash),
        blockHash: toHash32(log.block_hash),
        blockNumber: numberTo0x(log.block_number),
        transactionIndex: numberTo0x(log.transaction_index),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Synthetic transaction for token ${tokenId} was not indexed within ${timeoutMs}ms`);
}
