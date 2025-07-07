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
import { legacyTransaction, transaction1559, transaction1559_2930, transaction2930 } from './transactions';
import { getTransactionCount } from './utils';

export async function updateRequestParams(fileName: string, request: any) {
  const paramMappings = buildTransactionOverrides();
  const fullPath = `overwrites/${request.method}/${fileName}`;

  if (fullPath in paramMappings) {
    const mapping = paramMappings[fullPath];
    for (const [paramIndex, value] of Object.entries(mapping)) {
      let resolvedValue = value;
      if (typeof value === 'function') {
        resolvedValue = await (value as () => Promise<any>)();
      }
      request.params[parseInt(paramIndex)] = resolvedValue;
    }
  }

  return request;
}

function buildTransactionOverrides() {
  async function prepareTransaction(transaction: any, privateKey: any) {
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
