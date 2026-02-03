// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { MethodRateLimitConfiguration } from '../types';

// Lazy getter function that reads config at call time (not module load time)
// This allows test environment overrides to work properly
export function getMethodConfiguration(): MethodRateLimitConfiguration {
  const tier1rateLimit = ConfigService.get('TIER_1_RATE_LIMIT');
  const tier2rateLimit = ConfigService.get('TIER_2_RATE_LIMIT');
  const tier3rateLimit = ConfigService.get('TIER_3_RATE_LIMIT');

  return {
    web3_clientVersion: {
      total: tier3rateLimit,
    },
    web3_sha3: {
      total: tier3rateLimit,
    },
    net_listening: {
      total: tier3rateLimit,
    },
    net_version: {
      total: tier3rateLimit,
    },
    net_peerCount: {
      total: tier3rateLimit,
    },
    ADMIN_CONFIG: {
      total: tier3rateLimit,
    },
    eth_blockNumber: {
      total: tier2rateLimit,
    },
    eth_call: {
      total: tier1rateLimit,
    },
    eth_coinbase: {
      total: tier2rateLimit,
    },
    eth_simulateV1: {
      total: tier2rateLimit,
    },
    eth_blobBaseFee: {
      total: tier2rateLimit,
    },
    eth_estimateGas: {
      total: tier2rateLimit,
    },
    eth_gasPrice: {
      total: tier2rateLimit,
    },
    eth_getBalance: {
      total: tier2rateLimit,
    },
    eth_getBlockByHash: {
      total: tier2rateLimit,
    },
    eth_getBlockByNumber: {
      total: tier2rateLimit,
    },
    eth_getBlockReceipts: {
      total: tier2rateLimit,
    },
    eth_getBlockTransactionCountByHash: {
      total: tier2rateLimit,
    },
    eth_getBlockTransactionCountByNumber: {
      total: tier2rateLimit,
    },
    eth_getCode: {
      total: tier2rateLimit,
    },
    eth_chainId: {
      total: tier2rateLimit,
    },
    eth_getFilterChanges: {
      total: tier2rateLimit,
    },
    eth_getLogs: {
      total: tier2rateLimit,
    },
    eth_getStorageAt: {
      total: tier2rateLimit,
    },
    eth_getTransactionByBlockHashAndIndex: {
      total: tier2rateLimit,
    },
    eth_getTransactionByBlockNumberAndIndex: {
      total: tier2rateLimit,
    },
    eth_getTransactionByHash: {
      total: tier2rateLimit,
    },
    eth_getTransactionCount: {
      total: tier2rateLimit,
    },
    eth_getTransactionReceipt: {
      total: tier2rateLimit,
    },
    eth_getUncleByBlockHashAndIndex: {
      total: tier2rateLimit,
    },
    eth_getUncleByBlockNumberAndIndex: {
      total: tier2rateLimit,
    },
    eth_getUncleCountByBlockHash: {
      total: tier2rateLimit,
    },
    eth_getUncleCountByBlockNumber: {
      total: tier2rateLimit,
    },
    eth_getWork: {
      total: tier2rateLimit,
    },
    eth_feeHistory: {
      total: tier2rateLimit,
    },
    eth_hashrate: {
      total: tier1rateLimit,
    },
    eth_maxPriorityFeePerGas: {
      total: tier1rateLimit,
    },
    eth_mining: {
      total: tier1rateLimit,
    },
    eth_protocolVersion: {
      total: tier2rateLimit,
    },
    eth_sendRawTransaction: {
      total: tier1rateLimit,
    },
    eth_sendTransaction: {
      total: tier1rateLimit,
    },
    eth_sign: {
      total: tier1rateLimit,
    },
    eth_signTransaction: {
      total: tier1rateLimit,
    },
    eth_submitHashrate: {
      total: tier1rateLimit,
    },
    eth_submitWork: {
      total: tier1rateLimit,
    },
    eth_syncing: {
      total: tier1rateLimit,
    },
    eth_accounts: {
      total: tier2rateLimit,
    },
    eth_newBlockFilter: {
      total: tier2rateLimit,
    },
    eth_newPendingTransactionFilter: {
      total: tier2rateLimit,
    },
    eth_newFilter: {
      total: tier2rateLimit,
    },
    eth_uninstallFilter: {
      total: tier2rateLimit,
    },
    eth_getFilterLogs: {
      total: tier2rateLimit,
    },
    debug_traceTransaction: {
      total: tier1rateLimit,
    },
    debug_traceBlockByNumber: {
      total: tier1rateLimit,
    },
    debug_traceBlockByHash: {
      total: tier1rateLimit,
    },
    batch_request: {
      total: tier1rateLimit,
    },
    eth_getProof: {
      total: tier2rateLimit,
    },
    eth_createAccessList: {
      total: tier2rateLimit,
    },
  };
}

// Backwards compatibility: Export a Proxy that lazily calls getMethodConfiguration()
// This allows existing code to use `methodConfiguration.eth_chainId` without changes
// A Proxy is used for lazy evaluation to ensure test configuration overrides work correctly
// (ConfigService is read at access time, not module load time).
export const methodConfiguration = new Proxy({} as MethodRateLimitConfiguration, {
  get(target, prop) {
    return getMethodConfiguration()[prop as keyof MethodRateLimitConfiguration];
  },
});
