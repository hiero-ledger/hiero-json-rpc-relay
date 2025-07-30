## Relay RPS by path in the last 90 days

| Name                                    | Mean             | Percentage |
| --------------------------------------- | ---------------- | ---------- |
| eth_getBlockByNumber                    | 96.3 req/s       | 68.70%     |
| eth_getLogs                             | 18.2 req/s       | 13.00%     |
| eth_chainId                             | 8.33 req/s       | 5.94%      |
| eth_blockNumber                         | 7.42 req/s       | 5.30%      |
| eth_call                                | 4.56 req/s       | 3.26%      |
| eth_getBlockByHash                      | 2.76 req/s       | 1.97%      |
| eth_getTransactionReceipt               | 1.15 req/s       | 0.82%      |
| eth_getBalance                          | 0.891 req/s      | 0.64%      |
| debug_traceBlockByNumber                | 0.678 req/s      | 0.48%      |
| eth_syncing                             | 0.452 req/s      | 0.32%      |
| eth_gasPrice                            | 0.401 req/s      | 0.29%      |
| eth_sendRawTransaction                  | 0.386 req/s      | 0.28%      |
| eth_getTransactionCount                 | 0.317 req/s      | 0.23%      |
| net_version                             | 0.155 req/s      | 0.11%      |
| eth_getTransactionByHash                | 0.116 req/s      | 0.08%      |
| eth_estimateGas                         | 0.0651 req/s     | 0.05%      |
| eth_getFilterChanges                    | 0.0643 req/s     | 0.05%      |
| eth_getCode                             | 0.0391 req/s     | 0.03%      |
| debug_traceTransaction                  | 0.0283 req/s     | 0.02%      |
| web3_clientVersion                      | 0.0275 req/s     | 0.02%      |
| eth_getBlockReceipts                    | 0.0251 req/s     | 0.02%      |
| eth_maxPriorityFeePerGas                | 0.0166 req/s     | 0.012%     |
| eth_getFilterLogs                       | 0.00877 req/s    | 0.0063%    |
| net_listening                           | 0.00809 req/s    | 0.0058%    |
| eth_feeHistory                          | 0.00683 req/s    | 0.0049%    |
| eth_getStorageAt                        | 0.00631 req/s    | 0.0045%    |
| eth_newFilter                           | 0.00298 req/s    | 0.0021%    |
| eth_uninstallFilter                     | 0.00112 req/s    | 0.0008%    |
| eth_submitHashrate                      | 0.000913 req/s   | 0.0007%    |
| eth_protocolVersion                     | 0.000784 req/s   | 0.0006%    |
| eth_newPendingTransactionFilter         | 0.000688 req/s   | 0.0005%    |
| eth_hashrate                            | 0.000673 req/s   | 0.0005%    |
| eth_getTransactionByBlockHashAndIndex   | 0.000661 req/s   | 0.0005%    |
| eth_signTransaction                     | 0.000582 req/s   | 0.0004%    |
| eth_getBlockTransactionCountByHash      | 0.000576 req/s   | 0.0004%    |
| eth_coinbase                            | 0.000517 req/s   | 0.0004%    |
| eth_sign                                | 0.000491 req/s   | 0.0004%    |
| eth_getTransactionByBlockNumberAndIndex | 0.000465 req/s   | 0.0003%    |
| eth_getUncleByBlockNumberAndIndex       | 0.000457 req/s   | 0.0003%    |
| eth_getUncleByBlockHashAndIndex         | 0.000430 req/s   | 0.0003%    |
| eth_accounts                            | 0.000386 req/s   | 0.0003%    |
| eth_getBlockTransactionCountByNumber    | 0.000359 req/s   | 0.0003%    |
| eth_mining                              | 0.000343 req/s   | 0.0002%    |
| eth_getUncleCountByBlockNumber          | 0.000343 req/s   | 0.0002%    |
| eth_getUncleCountByBlockHash            | 0.000328 req/s   | 0.0002%    |
| eth_submitWork                          | 0.000323 req/s   | 0.0002%    |
| eth_getWork                             | 0.000307 req/s   | 0.0002%    |
| eth_sendTransaction                     | 0.000260 req/s   | 0.0002%    |
| eth_newBlockFilter                      | 0.0000415 req/s  | 0.00003%   |
| eth_blobBaseFee                         | 0.00000758 req/s | 0.00001%   |
| eth_getProof                            | 0.00000657 req/s | 0.00001%   |
| net_peerCount                           | 0.00000430 req/s | 0.000003%  |
| web3_sha3                               | 0.00000114 req/s | 0.000001%  |
| eth_createAccessList                    | 0.00000885 req/s | 0.00001%   |

**Total RPS:** 140.2 req/s

## Relay Response Latency by path in the last 90 days

| Name                                    | Mean     |
| --------------------------------------- | -------- |
| eth_estimateGas                         | 1.53 s   |
| eth_getLogs                             | 262 ms   |
| eth_getTransactionReceipt               | 185 ms   |
| eth_getTransactionByHash                | 156 ms   |
| eth_sendRawTransaction                  | 141 ms   |
| eth_getBalance                          | 125 ms   |
| debug_traceTransaction                  | 124 ms   |
| eth_getBlockReceipts                    | 120 ms   |
| eth_getTransactionCount                 | 118 ms   |
| eth_getFilterChanges                    | 117 ms   |
| eth_getCode                             | 104 ms   |
| eth_getStorageAt                        | 70.6 ms  |
| eth_getBlockByNumber                    | 65.5 ms  |
| eth_call                                | 56.5 ms  |
| eth_getFilterLogs                       | 53.1 ms  |
| eth_getBlockByHash                      | 29.8 ms  |
| eth_blockNumber                         | 25.7 ms  |
| eth_feeHistory                          | 23.1 ms  |
| eth_newFilter                           | 9.22 ms  |
| eth_getTransactionByBlockHashAndIndex   | 5.29 ms  |
| eth_gasPrice                            | 4.52 ms  |
| eth_uninstallFilter                     | 3.00 ms  |
| eth_newBlockFilter                      | 2 ms     |
| net_listening                           | 1.31 ms  |
| web3_clientVersion                      | 1.04 ms  |
| eth_syncing                             | 1.04 ms  |
| eth_chainId                             | 1.02 ms  |
| eth_accounts                            | 1 ms     |
| eth_maxPriorityFeePerGas                | 0.994 ms |
| net_version                             | 0.980 ms |
| debug_traceBlockByNumber                | 0.492 ms |
| eth_hashrate                            | 0.346 ms |
| eth_blobBaseFee                         | 0 ms     |
| eth_coinbase                            | 0 ms     |
| eth_createAccessList                    | 0 ms     |
| eth_getBlockTransactionCountByHash      | 0 ms     |
| eth_getBlockTransactionCountByNumber    | 0 ms     |
| eth_getProof                            | 0 ms     |
| eth_getTransactionByBlockNumberAndIndex | 0 ms     |
| eth_getUncleByBlockHashAndIndex         | 0 ms     |
| eth_getUncleByBlockNumberAndIndex       | 0 ms     |
| eth_getUncleCountByBlockHash            | 0 ms     |
| eth_getUncleCountByBlockNumber          | 0 ms     |
| eth_getWork                             | 0 ms     |
| eth_mining                              | 0 ms     |
| eth_newPendingTransactionFilter         | 0 ms     |
| eth_protocolVersion                     | 0 ms     |
| eth_sendTransaction                     | 0 ms     |
| eth_sign                                | 0 ms     |
| eth_signTransaction                     | 0 ms     |
| eth_submitHashrate                      | 0 ms     |
| eth_submitWork                          | 0 ms     |
| net_peerCount                           | 0 ms     |
| web3_sha3                               | 0 ms     |
