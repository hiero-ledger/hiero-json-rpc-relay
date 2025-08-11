# K6 Traffic Weights Report

## Purpose

This report provides the recommended `trafficWeights` configuration for K6 performance tests based on real production traffic data from HashIO. The goal is to replace the current equal-weight testing approach with realistic traffic distribution that reflects actual endpoint usage patterns.

## Data Source

Traffic data collected from Grafana dashboard covering 90 days (April 29 - July 29, 2025). The data shows RPS (Requests Per Second) for each endpoint and calculates the percentage distribution across all traffic.

## Traffic Data (90 days: April 29 - July 29, 2025)

| Name                                    | Mean RPS   | Percentage |
| --------------------------------------- | ---------- | ---------- |
| eth_getBlockByNumber                    | 96.3       | 68.70%     |
| eth_getLogs                             | 18.2       | 13.00%     |
| eth_chainId                             | 8.33       | 5.94%      |
| eth_blockNumber                         | 7.42       | 5.30%      |
| eth_call                                | 4.56       | 3.26%      |
| eth_getBlockByHash                      | 2.76       | 1.97%      |
| eth_getTransactionReceipt               | 1.15       | 0.82%      |
| eth_getBalance                          | 0.891      | 0.64%      |
| debug_traceBlockByNumber                | 0.678      | 0.48%      |
| eth_syncing                             | 0.452      | 0.32%      |
| eth_gasPrice                            | 0.401      | 0.29%      |
| eth_sendRawTransaction                  | 0.386      | 0.28%      |
| eth_getTransactionCount                 | 0.317      | 0.23%      |
| net_version                             | 0.155      | 0.11%      |
| eth_getTransactionByHash                | 0.116      | 0.08%      |
| eth_estimateGas                         | 0.0651     | 0.05%      |
| eth_getFilterChanges                    | 0.0643     | 0.05%      |
| eth_getCode                             | 0.0391     | 0.03%      |
| debug_traceTransaction                  | 0.0283     | 0.02%      |
| web3_clientVersion                      | 0.0275     | 0.02%      |
| eth_getBlockReceipts                    | 0.0251     | 0.02%      |
| eth_maxPriorityFeePerGas                | 0.0166     | 0.012%     |
| eth_getFilterLogs                       | 0.00877    | 0.0063%    |
| net_listening                           | 0.00809    | 0.0058%    |
| eth_feeHistory                          | 0.00683    | 0.0049%    |
| eth_getStorageAt                        | 0.00631    | 0.0045%    |
| eth_newFilter                           | 0.00298    | 0.0021%    |
| eth_uninstallFilter                     | 0.00112    | 0.0008%    |
| eth_submitHashrate                      | 0.000913   | 0.0007%    |
| eth_protocolVersion                     | 0.000784   | 0.0006%    |
| eth_newPendingTransactionFilter         | 0.000688   | 0.0005%    |
| eth_hashrate                            | 0.000673   | 0.0005%    |
| eth_getTransactionByBlockHashAndIndex   | 0.000661   | 0.0005%    |
| eth_signTransaction                     | 0.000582   | 0.0004%    |
| eth_getBlockTransactionCountByHash      | 0.000576   | 0.0004%    |
| eth_coinbase                            | 0.000517   | 0.0004%    |
| eth_sign                                | 0.000491   | 0.0004%    |
| eth_getTransactionByBlockNumberAndIndex | 0.000465   | 0.0003%    |
| eth_getUncleByBlockNumberAndIndex       | 0.000457   | 0.0003%    |
| eth_getUncleByBlockHashAndIndex         | 0.000430   | 0.0003%    |
| eth_accounts                            | 0.000386   | 0.0003%    |
| eth_getBlockTransactionCountByNumber    | 0.000359   | 0.0003%    |
| eth_mining                              | 0.000343   | 0.0002%    |
| eth_getUncleCountByBlockNumber          | 0.000343   | 0.0002%    |
| eth_getUncleCountByBlockHash            | 0.000328   | 0.0002%    |
| eth_submitWork                          | 0.000323   | 0.0002%    |
| eth_getWork                             | 0.000307   | 0.0002%    |
| eth_sendTransaction                     | 0.000260   | 0.0002%    |
| eth_newBlockFilter                      | 0.0000415  | 0.00003%   |
| eth_blobBaseFee                         | 0.00000758 | 0.00001%   |
| eth_getProof                            | 0.00000657 | 0.00001%   |
| net_peerCount                           | 0.00000430 | 0.000003%  |
| web3_sha3                               | 0.00000114 | 0.000001%  |
| eth_createAccessList                    | 0.00000885 | 0.00001%   |

**Total RPS:** 140.2 req/s

## Recommended Weights

### Calculation Logic

```javascript
// For each endpoint:
// VUs = (endpoint_percentage / 100) × DEFAULT_VUS

// Example with DEFAULT_VUS = 100:
eth_getBlockByNumber: 68.70% × DEFAULT_VUS = 69 VUs
eth_getLogs: 13.00% × DEFAULT_VUS = 13 VUs
eth_chainId: 5.94% × DEFAULT_VUS = 6 VUs
// ... and so on
```

### Complete Traffic Weights Object

```javascript
const trafficWeights = {
  eth_getBlockByNumber: { vus: Math.round(0.687 * DEFAULT_VUS), duration: '60s' },
  eth_getLogs: { vus: Math.round(0.13 * DEFAULT_VUS), duration: '60s' },
  eth_chainId: { vus: Math.round(0.0594 * DEFAULT_VUS), duration: '60s' },
  eth_blockNumber: { vus: Math.round(0.053 * DEFAULT_VUS), duration: '60s' },
  eth_call: { vus: Math.round(0.0326 * DEFAULT_VUS), duration: '60s' },
  eth_getBlockByHash: { vus: Math.round(0.0197 * DEFAULT_VUS), duration: '60s' },
  eth_getTransactionReceipt: { vus: Math.round(0.0082 * DEFAULT_VUS), duration: '60s' },
  eth_getBalance: { vus: Math.round(0.0064 * DEFAULT_VUS), duration: '60s' },
  debug_traceBlockByNumber: { vus: Math.round(0.0048 * DEFAULT_VUS), duration: '60s' },
  eth_syncing: { vus: Math.round(0.0032 * DEFAULT_VUS), duration: '60s' },
  eth_gasPrice: { vus: Math.round(0.0029 * DEFAULT_VUS), duration: '60s' },
  eth_sendRawTransaction: { vus: Math.round(0.0028 * DEFAULT_VUS), duration: '60s' },
  eth_getTransactionCount: { vus: Math.round(0.0023 * DEFAULT_VUS), duration: '60s' },
  net_version: { vus: Math.round(0.0011 * DEFAULT_VUS), duration: '60s' },
  eth_getTransactionByHash: { vus: Math.round(0.0008 * DEFAULT_VUS), duration: '60s' },
  eth_estimateGas: { vus: Math.round(0.0005 * DEFAULT_VUS), duration: '60s' },
  eth_getFilterChanges: { vus: Math.round(0.0005 * DEFAULT_VUS), duration: '60s' },
  eth_getCode: { vus: Math.round(0.0003 * DEFAULT_VUS), duration: '60s' },
  debug_traceTransaction: { vus: Math.round(0.0002 * DEFAULT_VUS), duration: '60s' },
  web3_clientVersion: { vus: Math.round(0.0002 * DEFAULT_VUS), duration: '60s' },
  eth_getBlockReceipts: { vus: Math.round(0.0002 * DEFAULT_VUS), duration: '60s' },
  eth_maxPriorityFeePerGas: { vus: Math.round(0.00012 * DEFAULT_VUS), duration: '60s' },
  eth_getFilterLogs: { vus: Math.round(0.000063 * DEFAULT_VUS), duration: '60s' },
  net_listening: { vus: Math.round(0.000058 * DEFAULT_VUS), duration: '60s' },
  eth_feeHistory: { vus: Math.round(0.000049 * DEFAULT_VUS), duration: '60s' },
  eth_getStorageAt: { vus: Math.round(0.000045 * DEFAULT_VUS), duration: '60s' },
  eth_newFilter: { vus: Math.round(0.000021 * DEFAULT_VUS), duration: '60s' },
  eth_uninstallFilter: { vus: Math.round(0.000008 * DEFAULT_VUS), duration: '60s' },
  eth_submitHashrate: { vus: Math.round(0.000007 * DEFAULT_VUS), duration: '60s' },
  eth_protocolVersion: { vus: Math.round(0.000006 * DEFAULT_VUS), duration: '60s' },
  eth_newPendingTransactionFilter: { vus: Math.round(0.000005 * DEFAULT_VUS), duration: '60s' },
  eth_hashrate: { vus: Math.round(0.000005 * DEFAULT_VUS), duration: '60s' },
  eth_getTransactionByBlockHashAndIndex: { vus: Math.round(0.000005 * DEFAULT_VUS), duration: '60s' },
  eth_signTransaction: { vus: Math.round(0.000004 * DEFAULT_VUS), duration: '60s' },
  eth_getBlockTransactionCountByHash: { vus: Math.round(0.000004 * DEFAULT_VUS), duration: '60s' },
  eth_coinbase: { vus: Math.round(0.000004 * DEFAULT_VUS), duration: '60s' },
  eth_sign: { vus: Math.round(0.000004 * DEFAULT_VUS), duration: '60s' },
  eth_getTransactionByBlockNumberAndIndex: { vus: Math.round(0.000003 * DEFAULT_VUS), duration: '60s' },
  eth_getUncleByBlockNumberAndIndex: { vus: Math.round(0.000003 * DEFAULT_VUS), duration: '60s' },
  eth_getUncleByBlockHashAndIndex: { vus: Math.round(0.000003 * DEFAULT_VUS), duration: '60s' },
  eth_accounts: { vus: Math.round(0.000003 * DEFAULT_VUS), duration: '60s' },
  eth_getBlockTransactionCountByNumber: { vus: Math.round(0.000003 * DEFAULT_VUS), duration: '60s' },
  eth_mining: { vus: Math.round(0.000002 * DEFAULT_VUS), duration: '60s' },
  eth_getUncleCountByBlockNumber: { vus: Math.round(0.000002 * DEFAULT_VUS), duration: '60s' },
  eth_getUncleCountByBlockHash: { vus: Math.round(0.000002 * DEFAULT_VUS), duration: '60s' },
  eth_submitWork: { vus: Math.round(0.000002 * DEFAULT_VUS), duration: '60s' },
  eth_getWork: { vus: Math.round(0.000002 * DEFAULT_VUS), duration: '60s' },
  eth_sendTransaction: { vus: Math.round(0.000002 * DEFAULT_VUS), duration: '60s' },
  eth_newBlockFilter: { vus: Math.round(0.0000003 * DEFAULT_VUS), duration: '60s' },
  eth_blobBaseFee: { vus: Math.round(0.00000001 * DEFAULT_VUS), duration: '60s' },
  eth_getProof: { vus: Math.round(0.00000001 * DEFAULT_VUS), duration: '60s' },
  net_peerCount: { vus: Math.round(0.000000003 * DEFAULT_VUS), duration: '60s' },
  web3_sha3: { vus: Math.round(0.000000001 * DEFAULT_VUS), duration: '60s' },
  eth_createAccessList: { vus: Math.round(0.00000001 * DEFAULT_VUS), duration: '60s' },
};
```

## Conclusion

This analysis shows that traffic is heavily concentrated in a few endpoints, with `eth_getBlockByNumber` alone handling 68.7% of all requests. By implementing RPS-based traffic weighting, our K6 performance tests will now reflect real production usage patterns rather than treating all endpoints equally, leading to more accurate performance insights and better bottleneck detection.
