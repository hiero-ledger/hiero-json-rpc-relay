// SPDX-License-Identifier: Apache-2.0
import { signTransaction } from '@hashgraph/json-rpc-relay/tests/helpers';

import {
  createContractLegacyTransactionAndBlockHash,
  currentBlockHash,
  EMPTY_TX_HASH,
  ETHEREUM_NETWORK_ACCOUNT_HASH,
  legacyTransactionAndBlockHash,
  localNodeAccountPrivateKey,
  NONEXISTENT_TX_HASH,
  RELAY_URL,
  transaction1559AndBlockHash,
  transaction2930AndBlockHash,
} from './constants';
import { JsonRpcRequest, Transaction } from './interfaces';
import { legacyTransaction, transaction1559, transaction1559_2930, transaction2930 } from './transactions';
import { getTransactionCount } from './utils';

/**
 * Updates request parameters for JSON-RPC requests based on predefined mappings.
 * This function allows overriding specific parameters in JSON-RPC requests for testing purposes
 * by using file-based mappings that correspond to specific test scenarios.
 *
 * @template T - The type of the resolved parameter value
 * @param {string} fileName - The name of the test file (e.g., 'get-block-by-hash.io')
 * @param {JsonRpcRequest} request - The JSON-RPC request object containing method and params
 * @returns {Promise<JsonRpcRequest>} A promise that resolves to the updated JSON-RPC request
 *
 * @example
 * ```typescript
 * const request = {
 *   jsonrpc: '2.0',
 *   id: 1,
 *   method: 'eth_getTransactionByHash',
 *   params: ['0x...']
 * };
 *
 * const updatedRequest = await updateRequestParams('get-legacy-tx.io', request);
 * // The request.params[0] will be updated with the corresponding transaction hash
 * ```
 *
 * @remarks
 * The `buildTransactionOverrides` function provides a comprehensive mapping of test scenarios
 * to their corresponding parameter overrides, including static values (transaction hashes,
 * block hashes, account addresses) and dynamic functions that prepare and sign transactions
 * with current nonces for `eth_sendRawTransaction` test cases.
 */
export async function updateRequestParams<T = unknown>(
  fileName: string,
  request: JsonRpcRequest,
): Promise<JsonRpcRequest> {
  const paramMappings = buildTransactionOverrides();
  const fullPath = `overwrites/${request.method}/${fileName}`;

  if (fullPath in paramMappings) {
    const mapping = paramMappings[fullPath];
    for (const [paramIndex, value] of Object.entries(mapping)) {
      let resolvedValue: T | string = value as T | string;
      if (typeof value === 'function') {
        resolvedValue = await (value as () => Promise<T>)();
      }
      request.params[parseInt(paramIndex)] = resolvedValue;
    }
  }

  return request;
}

function buildTransactionOverrides() {
  async function prepareTransaction(transaction: Transaction, privateKey: string) {
    const nonce = parseInt(await getTransactionCount(RELAY_URL), 16);
    const txToSign = { ...transaction, nonce };
    return await signTransaction(txToSign, privateKey);
  }

  return {
    ['overwrites/eth_getBlockByHash/get-block-by-hash.io']: {
      '0': transaction2930AndBlockHash.blockHash,
    },
    ['overwrites/eth_getTransactionByHash/get-access-list.io']: {
      '0': transaction2930AndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionByHash/get-dynamic-fee.io']: {
      '0': transaction1559AndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionByHash/get-empty-tx.io']: {
      '0': EMPTY_TX_HASH,
    },
    ['overwrites/eth_getTransactionByHash/get-legacy-create.io']: {
      '0': createContractLegacyTransactionAndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionByHash/get-legacy-input.io']: {
      '0': createContractLegacyTransactionAndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionByHash/get-legacy-contract.io']: {
      '0': createContractLegacyTransactionAndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionByHash/get-legacy-tx.io']: {
      '0': legacyTransactionAndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionByHash/get-notfound-tx.io']: {
      '0': NONEXISTENT_TX_HASH,
    },
    ['overwrites/eth_getTransactionReceipt/get-legacy-receipt.io']: {
      '0': legacyTransactionAndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionReceipt/get-access-list.io']: {
      '0': transaction2930AndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionReceipt/get-dynamic-fee.io']: {
      '0': transaction1559AndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionReceipt/get-legacy-contract.io']: {
      '0': createContractLegacyTransactionAndBlockHash.transactionHash,
    },
    ['overwrites/eth_getTransactionReceipt/get-legacy-input.io']: {
      '0': createContractLegacyTransactionAndBlockHash.transactionHash,
    },
    ['overwrites/eth_getBalance/get-balance.io']: {
      '0': ETHEREUM_NETWORK_ACCOUNT_HASH,
      '1': 'latest',
    },
    ['overwrites/eth_getBalance/get-balance-blockhash.io']: {
      '0': ETHEREUM_NETWORK_ACCOUNT_HASH,
      '1': currentBlockHash,
    },
    ['overwrites/eth_getTransactionByBlockHashAndIndex/get-block-n.io']: {
      '0': legacyTransactionAndBlockHash.blockHash,
      '1': legacyTransactionAndBlockHash.transactionIndex,
    },
    ['overwrites/eth_getTransactionByBlockNumberAndIndex/get-block-n.io']: {
      '0': legacyTransactionAndBlockHash.blockNumber,
      '1': legacyTransactionAndBlockHash.transactionIndex,
    },
    ['overwrites/eth_sendRawTransaction/send-legacy-transaction.io']: {
      '0': () => prepareTransaction(legacyTransaction, localNodeAccountPrivateKey),
    },
    ['overwrites/eth_sendRawTransaction/send-dynamic-fee-transaction.io']: {
      '0': () => prepareTransaction(transaction1559, localNodeAccountPrivateKey),
    },
    ['overwrites/eth_sendRawTransaction/send-dynamic-fee-access-list-transaction.io']: {
      '0': () => prepareTransaction(transaction1559_2930, localNodeAccountPrivateKey),
    },
    ['overwrites/eth_sendRawTransaction/send-blob-tx.io']: {
      '0': () => prepareTransaction(legacyTransaction, localNodeAccountPrivateKey),
    },
    ['overwrites/eth_sendRawTransaction/send-access-list-transaction.io']: {
      '0': () => prepareTransaction(transaction2930, localNodeAccountPrivateKey),
    },
  };
}
