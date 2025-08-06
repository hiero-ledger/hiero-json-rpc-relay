// SPDX-License-Identifier: Apache-2.0

/**
 * Traffic weights from real production data (90 days: April 29 - July 29, 2025)
 */
export const trafficWeights = {
  eth_getBlockByNumber: 0.687,
  eth_getLogs: 0.13,
  eth_chainId: 0.0594,
  eth_blockNumber: 0.053,
  eth_call: 0.0326,
  eth_getBlockByHash: 0.0197,
  eth_getTransactionReceipt: 0.0082,
  eth_getBalance: 0.0064,
  debug_traceBlockByNumber: 0.0048,
  eth_syncing: 0.0032,
  eth_gasPrice: 0.0029,
  eth_sendRawTransaction: 0.0028,
  eth_getTransactionCount: 0.0023,
  net_version: 0.0011,
  eth_getTransactionByHash: 0.0008,
  eth_estimateGas: 0.0005,
  eth_getFilterChanges: 0.0005,
  eth_getCode: 0.0003,
  debug_traceTransaction: 0.0002,
  web3_clientVersion: 0.0002,
  eth_getBlockReceipts: 0.0002,
  eth_maxPriorityFeePerGas: 0.00012,
  eth_getFilterLogs: 0.000063,
  net_listening: 0.000058,
  eth_feeHistory: 0.000049,
  eth_getStorageAt: 0.000045,
  eth_newFilter: 0.000021,
  eth_uninstallFilter: 0.000008,
  eth_submitHashrate: 0.000007,
  eth_protocolVersion: 0.000006,
  eth_newPendingTransactionFilter: 0.000005,
  eth_hashrate: 0.000005,
  eth_getTransactionByBlockHashAndIndex: 0.000005,
  eth_signTransaction: 0.000004,
  eth_getBlockTransactionCountByHash: 0.000004,
  eth_coinbase: 0.000004,
  eth_sign: 0.000004,
  eth_getTransactionByBlockNumberAndIndex: 0.000003,
  eth_getUncleByBlockNumberAndIndex: 0.000003,
  eth_getUncleByBlockHashAndIndex: 0.000003,
  eth_accounts: 0.000003,
  eth_getBlockTransactionCountByNumber: 0.000003,
  eth_mining: 0.000002,
  eth_getUncleCountByBlockNumber: 0.000002,
  eth_getUncleCountByBlockHash: 0.000002,
  eth_submitWork: 0.000002,
  eth_getWork: 0.000002,
  eth_sendTransaction: 0.000002,
  eth_newBlockFilter: 0.0000003,
  eth_blobBaseFee: 0.00000001,
  eth_getProof: 0.00000001,
  net_peerCount: 0.000000003,
  web3_sha3: 0.000000001,
  eth_createAccessList: 0.00000001,
};

/**
 * Calculate VU allocation based on traffic weights and total VUs
 * Simple proportional allocation: VUs = DEFAULT_VUS * Percentage
 * @param {number} totalVUs - Total number of VUs to distribute
 * @returns {Object} VU allocation per endpoint
 */
export function calculateVUAllocation(totalVUs = 10) {
  const allocation = {};

  for (const [endpoint, weight] of Object.entries(trafficWeights)) {
    // Simple proportional allocation: VUs = totalVUs * percentage
    const vus = Math.round(weight * totalVUs);
    // Ensure minimum 1 VU only if the calculated value would be 0
    allocation[endpoint] = Math.max(1, vus);
  }

  // Store allocation globally for reporting
  globalThis.vuAllocation = allocation;

  return allocation;
}
