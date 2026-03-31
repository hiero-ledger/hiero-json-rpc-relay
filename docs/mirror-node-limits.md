## Mirror Node pagination limits

The Mirror Node exposes REST endpoints that support pagination via a per-page limit (configured in the Relay with MIRROR_NODE_LIMIT_PARAM) and a next link for subsequent pages.

The Relay enforces additional caps on how many pages it is willing to follow for a single client request.
These caps exist to bound the worst‑case number of records the Relay needs to aggregate and serialize into a JSON-RPC
response. If the resultant number of records is too large, the Relay can exhibit: high CPU and memory usage,
long serialization time, and timeouts at the response layer.

## Configuration parameters overview

- MIRROR_NODE_LIMIT_PARAM: The per-request **page size** the Relay asks the Mirror Node for. Defaults to 100.
  This value will be used in the query parameters for all endpoints that support pagination.

- ETH_GET_LOGS_BLOCK_RANGE_LIMIT: Maximum **block** span allowed for eth_getLogs filters (fromBlock..toBlock). Defaults to 1000.
- ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: Upper bound that indirectly limits how many **transactions** the Relay will gather when returning full transaction objects in eth_getBlockByNumber/hash (transactions: true). Defaults to 1000.

- MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX: Max **pages** for logs when the filter resolves to a single block scope. Default 200.
- MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX: Max **pages** for logs when a block range is used. Default 500.
- MIRROR_NODE_CONTRACT_RESULTS_PG_MAX: Max **pages** for generic contract results pagination (e.g., fetching contract results lists). Default 25.
- MIRROR_NODE_ACCOUNT_TXS_PG_MAX: Max **pages** for account transactions pagination. Default 100.

- MIRROR_NODE_TIMESTAMP_SLICING_CONCURRENCY: Number of **parallel** timestamp slices used when retrieving logs across wide ranges. Default 30.
- MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE: Target max logs **page size** per slice; used to derive slice sizes. Default 100.

## Formula

To determine what is the max number of records the Relay needs to aggregate and serialize into a JSON-RPC response,
we need to use the following formula:
Let:
- L = MIRROR_NODE_LIMIT_PARAM, default 100
- P_x = page cap for a specific flow (e.g., LOGS_PG_MAX, LOGS_BLOCK_RANGE_PG_MAX, CONTRACT_RESULTS_PG_MAX)
Then, the Relay’s worst‑case number of records fetched is bounded by:
- MaxRecords = L × P_x

This bound applies per logical list retrieval performed by the Relay **for a single JSON‑RPC call**.

Example:
- If L = 500 and P_x = 100, MaxRecords = 500 × 100 = 50,000

## Endpoints and impact

1. eth_getLogs
  - Max number of records affected by:
    - ETH_GET_LOGS_BLOCK_RANGE_LIMIT,
    - **MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX**,
    - **MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX**,
    - MIRROR_NODE_LIMIT_PARAM.
  - Behavior - when querying without an account filter:
    - If the request specifies fromBlock/toBlock beyond ETH_GET_LOGS_BLOCK_RANGE_LIMIT, the Relay rejects the request.
    - The Relay determines whether the filter is single‑block/narrow scope or spans a range, then applies the relevant page cap.
    - Worst‑case logs fetched = L × P_x:
      - MIRROR_NODE_LIMIT_PARAM × MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX or
      - MIRROR_NODE_LIMIT_PARAM × MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX
    - There is also a hardcoded maximum time interval for the block range query, set to 7 days.
  - Parameters which affect the performance but not the number of records fetched:
      - MIRROR_NODE_TIMESTAMP_SLICING_CONCURRENCY
      - MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE

- eth_getBlockByNumber, eth_getBlockByHash (with transactions=true)
  - Affected by:
    - ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE
    - **MIRROR_NODE_CONTRACT_RESULTS_PG_MAX**
    - MIRROR_NODE_LIMIT_PARAM.
  - Notes:
    - Lists fetched via Mirror Node pagination as part of the assembly work are limited by L × MIRROR_NODE_CONTRACT_RESULTS_PG_MAX (for those specific sub-queries).
    - ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE additional guard on how many transactions will be collected for a single response.
    - Worst‑case logs fetched = Min(MIRROR_NODE_LIMIT_PARAM × MIRROR_NODE_CONTRACT_RESULTS_PG_MAX, ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE):
  
- Contract results listing (internal flows that page through /contracts/results or /contracts/{id}/results)
  - Affected by: MIRROR_NODE_CONTRACT_RESULTS_PG_MAX, MIRROR_NODE_LIMIT_PARAM.
  - Worst‑case records fetched = L × MIRROR_NODE_CONTRACT_RESULTS_PG_MAX.

- Account transactions listing. We are using it to calculate the account balance for non-latest blocks, created less than 15 minutes ago (in such cases we can't get this value from the Mirror Node directly).

## Sample calculations

Choosing safe values - example (MN limit = 500)
- Operator sets MIRROR_NODE_LIMIT_PARAM = 500.
- To cap eth_getLogs (range) at ≈ 25k records, choose MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX = 50.
  - Max logs ≈ 500 × 50 = 25,000.
- To cap eth_getLogs (single/narrow) at ≈ 10k, choose MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX = 20.
  - Max logs ≈ 500 × 20 = 10,000.
- For generic contract result listing, keep MIRROR_NODE_CONTRACT_RESULTS_PG_MAX = 25.
  - Max results ≈ 500 × 25 = 12,500.
- For eth_getBlock* with transactions=true, keep ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE = 1000 (or reduce if needed).

### In order to keep the number of records the same after switching the page limit to 500 from 100, set the values:

MIRROR_NODE_LIMIT_PARAM=500
MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX=40
MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX=100
MIRROR_NODE_CONTRACT_RESULTS_PG_MAX=5

To make sure the total number of records processed is the same as before per request.