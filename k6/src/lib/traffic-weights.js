// SPDX-License-Identifier: Apache-2.0

/**
 * Traffic weights from real production data (90 days: April 29 - July 29, 2025)
 * Source: traffic-weights-report.md
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
 * Normalize traffic weights to ensure they sum to 1.0
 * @returns {Object} Normalized traffic weights
 */
function getNormalizedWeights() {
  const totalWeight = Object.values(trafficWeights).reduce((sum, weight) => sum + weight, 0);
  const normalized = {};

  for (const [endpoint, weight] of Object.entries(trafficWeights)) {
    normalized[endpoint] = weight / totalWeight;
  }

  return normalized;
}

/**
 * Calculate VU allocation based on traffic weights and total VUs
 * Simple proportional allocation: VUs = DEFAULT_VUS * Percentage
 * @param {number} totalVUs - Total number of VUs to distribute
 * @returns {Object} VU allocation per endpoint
 */
export function calculateVUAllocation(totalVUs = 10) {
  const normalizedWeights = getNormalizedWeights();
  const allocation = {};

  for (const [endpoint, weight] of Object.entries(normalizedWeights)) {
    // Simple proportional allocation: VUs = totalVUs * percentage
    const vus = Math.round(weight * totalVUs);
    // Ensure minimum 1 VU only if the calculated value would be 0
    allocation[endpoint] = Math.max(1, vus);
  }

  // Store allocation globally for reporting
  globalThis.vuAllocation = allocation;

  return allocation;
}

/**
 * Get stress test scenario options for a specific endpoint
 * @param {string} endpoint - The endpoint name
 * @param {number} totalVUs - Total VUs to distribute
 * @param {string} duration - Test duration
 * @returns {Object} K6 scenario configuration
 */
export function getStressScenarioOptions(endpoint, totalVUs = 10, duration = '60s') {
  const vuAllocation = calculateVUAllocation(totalVUs);

  return {
    executor: 'constant-vus',
    vus: vuAllocation[endpoint] || 1,
    duration: duration,
    startTime: '0s', // All scenarios start simultaneously for stress testing
    gracefulStop: __ENV.DEFAULT_GRACEFUL_STOP || '5s',
  };
}
