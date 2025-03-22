# KoaJsonRpc Rate Limit

Rate-limiting middleware for Koa Json Rpc. Use to limit repeated requests to APIs and/or endpoints by IP.

## Configuration

All rate-limiting options are exposed and can be configured from `.env` .
Limit tiers are total number of requests for a configurable duration per IP and endpoint.

```js
DEFAULT_RATE_LIMIT = 200;
TIER_1_RATE_LIMIT = 100;
TIER_2_RATE_LIMIT = 800;
TIER_3_RATE_LIMIT = 1600;
LIMIT_DURATION = 60000;
RATE_LIMIT_DISABLED = false;
```

- **DEFAULT_RATE_LIMIT**: - default fallback rate limit, if no other is configured. Default is to `200` (200 request per IP).
- **TIER_1_RATE_LIMIT**: - restrictive limiting tier, for expensive endpoints. Default is to `100` (100 request per IP).
- **TIER_2_RATE_LIMIT**: - moderate limiting tier, for non expensive endpoints. Default is to `800` (800 request per IP).
- **TIER_3_RATE_LIMIT**: - relaxed limiting tier. Default is to `1600` (1600 request per IP).
- **LIMIT_DURATION**: - reset limit duration. This creates a timestamp, which resets all limits, when it's reached. Default is to `60000` (1 minute).
- **RATE_LIMIT_DISABLED**: - if set to `true` no rate limiting will be performed.

The following table highlights each relay endpoint and the TIER associated with it as dictated by [methodConfiguration.ts](/packages/server/src/koaJsonRpc/lib/methodConfiguration.ts)

| Method endpoint                           | Tier              |
| ----------------------------------------- | ----------------- |
| `eth_accounts`                            | TIER_2_RATE_LIMIT |
| `eth_blockNumber`                         | TIER_2_RATE_LIMIT |
| `eth_call`                                | TIER_1_RATE_LIMIT |
| `eth_chainId`                             | TIER_2_RATE_LIMIT |
| `eth_coinbase`                            | TIER_2_RATE_LIMIT |
| `eth_estimateGas`                         | TIER_2_RATE_LIMIT |
| `eth_feeHistory`                          | TIER_2_RATE_LIMIT |
| `eth_gasPrice`                            | TIER_2_RATE_LIMIT |
| `eth_getBalance`                          | TIER_2_RATE_LIMIT |
| `eth_getCode`                             | TIER_2_RATE_LIMIT |
| `eth_getBlockByHash`                      | TIER_2_RATE_LIMIT |
| `eth_getBlockByNumber`                    | TIER_2_RATE_LIMIT |
| `eth_getBlockTransactionCountByHash`      | TIER_2_RATE_LIMIT |
| `eth_getBlockTransactionCountByNumber`    | TIER_2_RATE_LIMIT |
| `eth_getFilterLogs`                       | TIER_2_RATE_LIMIT |
| `eth_getFilterChanges`                    | TIER_2_RATE_LIMIT |
| `eth_getLogs`                             | TIER_2_RATE_LIMIT |
| `eth_getStorageAt`                        | TIER_2_RATE_LIMIT |
| `eth_getTransactionByBlockHashAndIndex`   | TIER_2_RATE_LIMIT |
| `eth_getTransactionByBlockNumberAndIndex` | TIER_2_RATE_LIMIT |
| `eth_getTransactionByHash`                | TIER_2_RATE_LIMIT |
| `eth_getTransactionCount`                 | TIER_2_RATE_LIMIT |
| `eth_getTransactionReceipt`               | TIER_2_RATE_LIMIT |
| `eth_getUncleByBlockHashAndIndex`         | TIER_2_RATE_LIMIT |
| `eth_getUncleByBlockNumberAndIndex`       | TIER_2_RATE_LIMIT |
| `eth_getUncleCountByBlockHash`            | TIER_2_RATE_LIMIT |
| `eth_getUncleCountByBlockNumber`          | TIER_2_RATE_LIMIT |
| `eth_getWork`                             | TIER_2_RATE_LIMIT |
| `eth_hashrate`                            | TIER_1_RATE_LIMIT |
| `eth_maxPriorityFeePerGas`                | TIER_1_RATE_LIMIT |
| `eth_mining`                              | TIER_1_RATE_LIMIT |
| `eth_newBlockFilter`                      | TIER_2_RATE_LIMIT |
| `eth_newFilter`                           | TIER_2_RATE_LIMIT |
| `eth_newPendingTransactionFilter`         | TIER_2_RATE_LIMIT |
| `eth_protocolVersion`                     | TIER_2_RATE_LIMIT |
| `eth_sendRawTransaction`                  | TIER_1_RATE_LIMIT |
| `eth_sendTransaction`                     | TIER_1_RATE_LIMIT |
| `eth_signTransaction`                     | TIER_1_RATE_LIMIT |
| `eth_sign`                                | TIER_1_RATE_LIMIT |
| `eth_submitHashrate`                      | TIER_1_RATE_LIMIT |
| `eth_submitWork`                          | TIER_1_RATE_LIMIT |
| `eth_syncing`                             | TIER_1_RATE_LIMIT |
| `engine_*` (all engine methods)           | TIER_2_RATE_LIMIT |
| `trace_*` (all engine methods)            | TIER_2_RATE_LIMIT |
| `debug_*` (all engine methods)            | TIER_2_RATE_LIMIT |
| `net_listening`                           | TIER_3_RATE_LIMIT |
| `net_version`                             | TIER_3_RATE_LIMIT |
| `net_peerCount`                           | TIER_3_RATE_LIMIT |
| `web3_clientVersion`                      | TIER_3_RATE_LIMIT |
| `web3_sha3`                               | TIER_3_RATE_LIMIT |
