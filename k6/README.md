# K6 Performance Tests

This module covers the [k6](https://k6.io/) based performance tests for the Hedera JSON RPC Relay.

## Install k6

1. The k6 test engine is needed to run the tests. Please follow
   the [official documentation](https://k6.io/docs/getting-started/installation/) to install k6.

2. Node packages
   ```shell
   npm install
   ```

## Run The Tests

The tests are organized in files matching their method.
You can run the tests of an API as a test suite, you can also run tests one at a time.

### Test Prepare

The test suite requires a set of signed transactions to be used on the `eth_sendRawTransaction` test.
Also needs a deployed set of smart contracts (minimum 1) to be used on the `eth_call`, `eth_getCode` test.
Also needs a set of wallets to be used on the `eth_getBalance`, `eth_getTransactionCount`, tests.
For the above reasons the `prep.js` script is provided to generate the required files for the tests to run.
There are some environment variables that can be used to configure the test suite, see below.

The script will generate the following files: `.smartContractParams.json` with the deployed smart contracts addresses and the wallets addresses and signed transactions to be used on the tests.

All the smart contracts deployed by the prepare script are of the same kind (Greeter), since used randomly, need to have the same parameter on data when calling `eth_call`

To generate these, you can run the following command:

#### Only Run Prepare

```shell
npm run prep
```

### Test Suite

To run a test suite, use the following commands:

#### Only Run K6 Tests

```shell
npm run k6
```

To run the prepare script and the test suite, use the following command:

```shell
npm run prep-and-run
```

### Environment Variables

| Parameter              | Description                                                                                                                                                                                                                                                                                                                                                                     | Default Value | Required |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| PRIVATE_KEY            | The Private Key (ECDSA) to use when preparing the tests and signing the txs                                                                                                                                                                                                                                                                                                     |               | true     |
| MIRROR_BASE_URL        | The URL for the mirror node to use. e.g. https://testnet.mirrornode.hedera.com                                                                                                                                                                                                                                                                                                  |               | true     |
| RELAY_BASE_URL         | The URL of the RCP-Relay to perform the Tests against. e.g. https://testnet.hashio.io/api                                                                                                                                                                                                                                                                                       |               | true     |
| DEFAULT_DURATION       | Duration of each test, K6 will perform as many requests as possible for each test in this given timeframe. Some tests might override this duration to a minimum for at least 1 successful call for that test. i.e: if DEFAULT_DURATION=1s, but `eth_sendRawTransaction` needs at least 3s, k6 will use the bigger of the 2 (3s). to try to guarantee at least 1 successful call | 120s          | false    |
| DEFAULT_VUS            | Amount of concurrent (VUS) Virtual Users (doing requests)                                                                                                                                                                                                                                                                                                                       | 10            | false    |
| DEFAULT_LIMIT          | ?                                                                                                                                                                                                                                                                                                                                                                               | 100           | false    |
| DEFAULT_PASS_RATE      | The percentage of request that must pass for passing check                                                                                                                                                                                                                                                                                                                      | 0.95          | false    |
| DEFAULT_MAX_DURATION   | Threshold for passing test in ms (each request response should not take longer than this to pass)                                                                                                                                                                                                                                                                               | 500           | false    |
| DEFAULT_GRACEFUL_STOP  | Time of Grace given at the end between each scenario is run.                                                                                                                                                                                                                                                                                                                    | 5s            | false    |
| FILTER_TEST            | Test or Tests to be run, separated by comma without blanks ie: `FILTER_TEST=eth_call`, `FILTER_TEST=eth_call,eth_chainId,eth_sendRawTransaction`                                                                                                                                                                                                                                | \*            | false    |
| DEBUG_MODE             | If true, both the prep script and the k6 tests will produce useful logging to debug                                                                                                                                                                                                                                                                                             | false         | false    |
| SIGNED_TXS             | Amount of signed Txs to generate by the prep script, to be used on eth_sendRawTransaction Tests                                                                                                                                                                                                                                                                                 | 10            | false    |
| TEST_TYPE              | Type of test to run, either `performance` or `load`                                                                                                                                                                                                                                                                                                                             | performance   | false    |
| SMART_CONTRACTS_AMOUNT | Amount of smart contracts to deploy by the prep script, to be used on eth_call, eth_getCode and eth_sendRawTransaction Tests                                                                                                                                                                                                                                                    | 1             | false    |
| WALLETS_AMOUNT         | Amount of wallets to generate by the prep script, to be used on eth_getBalance and eth_getTransactionCount, eth_call and other Tests                                                                                                                                                                                                                                            | 1             | false    |

#### Full Suite Test

To run all tests, just do

```shell
npm run prep-and-run
```

The test suite will run the tests sequentially with a configurable graceful stop time in between, so they don't
interfere with each other.

Once the tests complete, `k6` will show a summary report.

```
> npm run prep && npm run k6


> hedera-rpc-relay-k6-perf-test@0.1.0 prep
> env-cmd node src/prepare/prep.js

Address: 0x69f8Ac08373040Ed1d4151E13A11E8e5969C58c7
Deploying Greeter SC...
Greeter SC Address: 0x7Ca926babFe62e4fDBd29638B3247ee3Bce79DB4
Greet: Hey World!
Updating Greeter...
Greet: Hello Future!
Generating (10) Txs for Performance Test...
Creating smartContractParams.json file...

> hedera-rpc-relay-k6-perf-test@0.1.0 k6
> env-cmd --use-shell k6 run src/scenarios/apis.js


          /\      |‾‾| /‾‾/   /‾‾/
     /\  /  \     |  |/  /   /  /
    /  \/    \    |     (   /   ‾‾\
   /          \   |  |\  \ |  (‾)  |
  / __________ \  |__| \__\ \_____/ .io

  execution: local
     script: src/scenarios/apis.js
     output: -

  scenarios: (100.00%) 39 scenarios, 1 max VUs, 4m14s max duration (incl. graceful stop):
           * eth_accounts: 1 looping VUs for 1s (exec: run, gracefulStop: 5s)
           * eth_blockNumber: 1 looping VUs for 1s (exec: run, startTime: 6s, gracefulStop: 5s)
           * eth_call: 1 looping VUs for 1s (exec: run, startTime: 12s, gracefulStop: 5s)
           * eth_chainId: 1 looping VUs for 1s (exec: run, startTime: 18s, gracefulStop: 5s)
           * eth_coinbase: 1 looping VUs for 1s (exec: run, startTime: 24s, gracefulStop: 5s)
           * eth_estimateGas: 1 looping VUs for 1s (exec: run, startTime: 30s, gracefulStop: 5s)
           * eth_feeHistory: 1 looping VUs for 4s (exec: run, startTime: 36s, gracefulStop: 5s)
           * eth_gasPrice: 1 looping VUs for 1s (exec: run, startTime: 45s, gracefulStop: 5s)
           * eth_getBalance: 1 looping VUs for 1s (exec: run, startTime: 51s, gracefulStop: 5s)
           * eth_getBlockByHash: 1 looping VUs for 2s (exec: run, startTime: 57s, gracefulStop: 5s)
           * eth_getBlockByNumber: 1 looping VUs for 1s (exec: run, startTime: 1m4s, gracefulStop: 5s)
           * eth_getBlockTransactionCountByHash: 1 looping VUs for 4s (exec: run, startTime: 1m10s, gracefulStop: 5s)
           * eth_getBlockTransactionCountByNumber: 1 looping VUs for 2s (exec: run, startTime: 1m19s, gracefulStop: 5s)
           * eth_getCode: 1 looping VUs for 1s (exec: run, startTime: 1m26s, gracefulStop: 5s)
           * eth_getLogs: 1 looping VUs for 1s (exec: run, startTime: 1m32s, gracefulStop: 5s)
           * eth_getStorageAt: 1 looping VUs for 1s (exec: run, startTime: 1m38s, gracefulStop: 5s)
           * eth_getTransactionByBlockHashAndIndex: 1 looping VUs for 1s (exec: run, startTime: 1m44s, gracefulStop: 5s)
           * eth_getTransactionByBlockNumberAndIndex: 1 looping VUs for 1s (exec: run, startTime: 1m50s, gracefulStop: 5s)
           * eth_getTransactionByHash: 1 looping VUs for 1s (exec: run, startTime: 1m56s, gracefulStop: 5s)
           * eth_getTransactionCount: 1 looping VUs for 3s (exec: run, startTime: 2m2s, gracefulStop: 5s)
           * eth_getTransactionReceipt: 1 looping VUs for 1s (exec: run, startTime: 2m10s, gracefulStop: 5s)
           * eth_getUncleByBlockHashAndIndex: 1 looping VUs for 1s (exec: run, startTime: 2m16s, gracefulStop: 5s)
           * eth_getUncleByBlockNumberAndIndex: 1 looping VUs for 1s (exec: run, startTime: 2m22s, gracefulStop: 5s)
           * eth_getUncleCountByBlockHash: 1 looping VUs for 1s (exec: run, startTime: 2m28s, gracefulStop: 5s)
           * eth_getUncleCountByBlockNumber: 1 looping VUs for 1s (exec: run, startTime: 2m34s, gracefulStop: 5s)
           * eth_getWork: 1 looping VUs for 1s (exec: run, startTime: 2m40s, gracefulStop: 5s)
           * eth_hashrate: 1 looping VUs for 1s (exec: run, startTime: 2m46s, gracefulStop: 5s)
           * eth_mining: 1 looping VUs for 1s (exec: run, startTime: 2m52s, gracefulStop: 5s)
           * eth_protocolVersion: 1 looping VUs for 1s (exec: run, startTime: 2m58s, gracefulStop: 5s)
           * eth_sendRawTransaction: 1 looping VUs for 5s (exec: run, startTime: 3m4s, gracefulStop: 5s)
           * eth_sendTransaction: 1 looping VUs for 1s (exec: run, startTime: 3m14s, gracefulStop: 5s)
           * eth_sign: 1 looping VUs for 1s (exec: run, startTime: 3m20s, gracefulStop: 5s)
           * eth_signTransaction: 1 looping VUs for 1s (exec: run, startTime: 3m26s, gracefulStop: 5s)
           * eth_submitHashrate: 1 looping VUs for 1s (exec: run, startTime: 3m32s, gracefulStop: 5s)
           * eth_submitWork: 1 looping VUs for 1s (exec: run, startTime: 3m38s, gracefulStop: 5s)
           * eth_syncing: 1 looping VUs for 1s (exec: run, startTime: 3m44s, gracefulStop: 5s)
           * net_listening: 1 looping VUs for 1s (exec: run, startTime: 3m56s, gracefulStop: 5s)
           * web3_clientVersion: 1 looping VUs for 1s (exec: run, startTime: 4m2s, gracefulStop: 5s)


running (4m10.1s), 0/1 VUs, 200 complete and 1 interrupted iterations
eth_accounts                   ✓ [======================================] 1 VUs  1s
eth_blockNumber                ✓ [======================================] 1 VUs  1s
eth_call                       ✓ [======================================] 1 VUs  1s
eth_chainId                    ✓ [======================================] 1 VUs  1s
eth_coinbase                   ✓ [======================================] 1 VUs  1s
eth_estimateGas                ✓ [======================================] 1 VUs  1s
eth_feeHistory                 ✓ [======================================] 1 VUs  4s
eth_gasPrice                   ✓ [======================================] 1 VUs  1s
eth_getBalance                 ✓ [======================================] 1 VUs  1s
eth_getBlockByHash             ✓ [======================================] 1 VUs  2s
eth_getBlockByNumber           ✓ [======================================] 1 VUs  1s
eth_getBlockTransactionCoun... ✓ [======================================] 1 VUs  4s
eth_getBlockTransactionCoun... ✓ [======================================] 1 VUs  2s
eth_getCode                    ✓ [======================================] 1 VUs  1s
eth_getLogs                    ✓ [======================================] 1 VUs  1s
eth_getStorageAt               ✓ [======================================] 1 VUs  1s
eth_getTransactionByBlockHa... ✓ [======================================] 1 VUs  1s
eth_getTransactionByBlockNu... ✓ [======================================] 1 VUs  1s
eth_getTransactionByHash       ✓ [======================================] 1 VUs  1s
eth_getTransactionCount        ✓ [======================================] 1 VUs  3s
eth_getTransactionReceipt      ✓ [======================================] 1 VUs  1s
eth_getUncleByBlockHashAndI... ✓ [======================================] 1 VUs  1s
eth_getUncleByBlockNumberAn... ✓ [======================================] 1 VUs  1s
eth_getUncleCountByBlockHash   ✓ [======================================] 1 VUs  1s
eth_getUncleCountByBlockNumber ✓ [======================================] 1 VUs  1s
eth_getWork                    ✓ [======================================] 1 VUs  1s
eth_hashrate                   ✓ [======================================] 1 VUs  1s
eth_mining                     ✓ [======================================] 1 VUs  1s
eth_protocolVersion            ✓ [======================================] 1 VUs  1s
eth_sendRawTransaction         ✓ [======================================] 1 VUs  5s
eth_sendTransaction            ✓ [======================================] 1 VUs  1s
eth_sign                       ✓ [======================================] 1 VUs  1s
eth_signTransaction            ✓ [======================================] 1 VUs  1s
eth_submitHashrate             ✓ [======================================] 1 VUs  1s
eth_submitWork                 ✓ [======================================] 1 VUs  1s
eth_syncing                    ✓ [======================================] 1 VUs  1s
net_listening                  ✓ [======================================] 1 VUs  1s
web3_clientVersion             ✓ [======================================] 1 VUs  1s
     ✓ eth_accounts
     ✓ eth_blockNumber
     ✓ eth_call
     ✓ eth_chainId
     ✓ eth_coinbase
     ✓ eth_estimateGas
     ✓ eth_feeHistory
     ✓ eth_gasPrice
     ✓ eth_getBalance
     ✓ eth_getBlockByHash
     ✓ eth_getBlockByNumber
     ✓ eth_getBlockTransactionCountByHash
     ✓ eth_getBlockTransactionCountByNumber
     ✓ eth_getCode
     ✓ eth_getLogs
     ✓ eth_getStorageAt
     ✓ eth_getTransactionByBlockHashAndIndex
     ✓ eth_getTransactionByBlockNumberAndIndex
     ✓ eth_getTransactionByHash
     ✓ eth_getTransactionCount
     ✓ eth_getTransactionReceipt
     ✓ eth_getUncleByBlockHashAndIndex
     ✓ eth_getUncleByBlockNumberAndIndex
     ✓ eth_getUncleCountByBlockHash
     ✓ eth_getUncleCountByBlockNumber
     ✓ eth_getWork
     ✓ eth_hashrate
     ✓ eth_mining
     ✓ eth_protocolVersion
     ✓ eth_sendRawTransaction
     ✓ eth_sendTransaction
     ✓ eth_sign
     ✓ eth_signTransaction
     ✓ eth_submitHashrate
     ✓ eth_submitWork
     ✓ eth_syncing
     ✓ net_listening
     ✓ web3_clientVersion

     █ setup

     checks..........................................................................: 100.00% ✓ 200      ✗ 0
     ✓ { scenario:eth_accounts }.....................................................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_blockNumber }..................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_call }.........................................................: 100.00% ✓ 3        ✗ 0
     ✓ { scenario:eth_chainId }......................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_coinbase }.....................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_estimateGas }..................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_feeHistory }...................................................: 100.00% ✓ 12       ✗ 0
     ✓ { scenario:eth_gasPrice }.....................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_getBalance }...................................................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_getBlockByHash }...............................................: 100.00% ✓ 6        ✗ 0
     ✓ { scenario:eth_getBlockByNumber }.............................................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_getBlockTransactionCountByHash }...............................: 100.00% ✓ 7        ✗ 0
     ✓ { scenario:eth_getBlockTransactionCountByNumber }.............................: 100.00% ✓ 8        ✗ 0
     ✓ { scenario:eth_getCode }......................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_getLogs }......................................................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_getStorageAt }.................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_getTransactionByBlockHashAndIndex }............................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_getTransactionByBlockNumberAndIndex }..........................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_getTransactionByHash }.........................................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_getTransactionCount }..........................................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_getTransactionReceipt }........................................: 100.00% ✓ 4        ✗ 0
     ✓ { scenario:eth_getUncleByBlockHashAndIndex }..................................: 100.00% ✓ 6        ✗ 0
     ✓ { scenario:eth_getUncleByBlockNumberAndIndex }................................: 100.00% ✓ 6        ✗ 0
     ✓ { scenario:eth_getUncleCountByBlockHash }.....................................: 100.00% ✓ 6        ✗ 0
     ✓ { scenario:eth_getUncleCountByBlockNumber }...................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_getWork }......................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_hashrate }.....................................................: 100.00% ✓ 6        ✗ 0
     ✓ { scenario:eth_mining }.......................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_protocolVersion }..............................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_sendRawTransaction }...........................................: 100.00% ✓ 2        ✗ 0
     ✓ { scenario:eth_sendTransaction }..............................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_signTransaction }..............................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_sign }.........................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_submitHashrate }...............................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:eth_submitWork }...................................................: 100.00% ✓ 6        ✗ 0
     ✓ { scenario:eth_syncing }......................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:net_listening }....................................................: 100.00% ✓ 5        ✗ 0
     ✓ { scenario:web3_clientVersion }...............................................: 100.00% ✓ 5        ✗ 0
     data_received...................................................................: 1.1 MB  4.3 kB/s
     data_sent.......................................................................: 146 kB  583 B/s
     http_req_blocked................................................................: avg=105.8ms  min=85.84ms  med=98.87ms  max=402.15ms p(90)=112.67ms p(95)=132.4ms
     http_req_connecting.............................................................: avg=46.38ms  min=39.62ms  med=44.73ms  max=133.59ms p(90)=49.96ms  p(95)=54.76ms
     http_req_duration...............................................................: avg=182.61ms min=88.75ms  med=119.88ms max=2.62s    p(90)=230.34ms p(95)=265.06ms
       { expected_response:true }....................................................: avg=196.76ms min=88.92ms  med=131.21ms max=2.62s    p(90)=232.91ms p(95)=269.08ms
     ✓ { scenario:eth_accounts,expected_response:true }..............................: avg=109.06ms min=96.91ms  med=104.05ms max=131.21ms p(90)=124.92ms p(95)=128.06ms
     ✓ { scenario:eth_blockNumber,expected_response:true }...........................: avg=138.81ms min=125.67ms med=141.3ms  max=143.73ms p(90)=143.15ms p(95)=143.44ms
     ✓ { scenario:eth_call,expected_response:true }..................................: avg=275.8ms  min=271.24ms med=275.63ms max=280.53ms p(90)=279.55ms p(95)=280.04ms
     ✓ { scenario:eth_chainId,expected_response:true }...............................: avg=136.6ms  min=88.92ms  med=94ms     max=302.46ms p(90)=223.63ms p(95)=263.04ms
     ✓ { scenario:eth_coinbase,expected_response:true }..............................: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
     ✓ { scenario:eth_estimateGas,expected_response:true }...........................: avg=121.68ms min=97.61ms  med=116.85ms max=158.63ms p(90)=146.93ms p(95)=152.78ms
     ✓ { scenario:eth_feeHistory,expected_response:true }............................: avg=219.16ms min=201.72ms med=214.48ms max=250.21ms p(90)=236.21ms p(95)=242.77ms
     ✓ { scenario:eth_gasPrice,expected_response:true }..............................: avg=104.11ms min=92.46ms  med=93.85ms  max=131.75ms p(90)=122.66ms p(95)=127.2ms
     ✓ { scenario:eth_getBalance,expected_response:true }............................: avg=153.42ms min=132.52ms med=155.5ms  max=170.14ms p(90)=167.32ms p(95)=168.73ms
     ✓ { scenario:eth_getBlockByHash,expected_response:true }........................: avg=239.42ms min=222.74ms med=234.03ms max=260.62ms p(90)=260.44ms p(95)=260.53ms
     ✓ { scenario:eth_getBlockByNumber,expected_response:true }......................: avg=193.16ms min=185.28ms med=191.06ms max=205.24ms p(90)=201.28ms p(95)=203.26ms
     ✓ { scenario:eth_getBlockTransactionCountByHash,expected_response:true }........: avg=142.12ms min=128.41ms med=132.26ms max=162.97ms p(90)=159.62ms p(95)=161.29ms
     ✓ { scenario:eth_getBlockTransactionCountByNumber,expected_response:true }......: avg=173.16ms min=161.03ms med=171.74ms max=193.23ms p(90)=184.26ms p(95)=188.74ms
     ✓ { scenario:eth_getCode,expected_response:true }...............................: avg=127.1ms  min=94.06ms  med=141.03ms max=151.94ms p(90)=149.43ms p(95)=150.69ms
     ✓ { scenario:eth_getLogs,expected_response:true }...............................: avg=229.69ms min=204.11ms med=224.4ms  max=265.84ms p(90)=255.49ms p(95)=260.66ms
     ✓ { scenario:eth_getStorageAt,expected_response:true }..........................: avg=147.51ms min=135.1ms  med=143.16ms max=161.85ms p(90)=160.18ms p(95)=161.01ms
     ✓ { scenario:eth_getTransactionByBlockHashAndIndex,expected_response:true }.....: avg=137.95ms min=130.18ms med=140.24ms max=144.12ms p(90)=143.21ms p(95)=143.67ms
     ✓ { scenario:eth_getTransactionByBlockNumberAndIndex,expected_response:true }...: avg=191.07ms min=178.27ms med=188.41ms max=209.18ms p(90)=203.19ms p(95)=206.19ms
     ✓ { scenario:eth_getTransactionByHash,expected_response:true }..................: avg=204.07ms min=182.92ms med=198.29ms max=236.77ms p(90)=227.32ms p(95)=232.04ms
     ✓ { scenario:eth_getTransactionCount,expected_response:true }...................: avg=1.14s    min=245.83ms med=1.14s    max=2.03s    p(90)=2.02s    p(95)=2.02s
     ✓ { scenario:eth_getTransactionReceipt,expected_response:true }.................: avg=156.66ms min=144.15ms med=158.57ms max=165.34ms p(90)=164.71ms p(95)=165.03ms
     ✓ { scenario:eth_getUncleByBlockHashAndIndex,expected_response:true }...........: avg=100.91ms min=93.65ms  med=98.07ms  max=115.26ms p(90)=109.78ms p(95)=112.52ms
     ✓ { scenario:eth_getUncleByBlockNumberAndIndex,expected_response:true }.........: avg=101.79ms min=94.56ms  med=95.85ms  max=130.83ms p(90)=114.96ms p(95)=122.89ms
     ✓ { scenario:eth_getUncleCountByBlockHash,expected_response:true }..............: avg=98.07ms  min=90.54ms  med=98.22ms  max=108.95ms p(90)=104.45ms p(95)=106.7ms
     ✓ { scenario:eth_getUncleCountByBlockNumber,expected_response:true }............: avg=111.21ms min=109.82ms med=111.88ms max=112.42ms p(90)=112.23ms p(95)=112.33ms
     ✓ { scenario:eth_getWork,expected_response:true }...............................: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
     ✓ { scenario:eth_hashrate,expected_response:true }..............................: avg=101.65ms min=94.3ms   med=101.83ms max=109.93ms p(90)=106.39ms p(95)=108.16ms
     ✓ { scenario:eth_mining,expected_response:true }................................: avg=108.08ms min=91.49ms  med=107ms    max=122.72ms p(90)=122.36ms p(95)=122.54ms
     ✓ { scenario:eth_protocolVersion,expected_response:true }.......................: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
     ✓ { scenario:eth_sendRawTransaction,expected_response:true }....................: avg=2.6s     min=2.58s    med=2.6s     max=2.62s    p(90)=2.62s    p(95)=2.62s
     ✓ { scenario:eth_sendTransaction,expected_response:true }.......................: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
     ✓ { scenario:eth_sign,expected_response:true }..................................: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
     ✓ { scenario:eth_signTransaction,expected_response:true }.......................: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
     ✓ { scenario:eth_submitHashrate,expected_response:true }........................: avg=0s       min=0s       med=0s       max=0s       p(90)=0s       p(95)=0s
     ✓ { scenario:eth_submitWork,expected_response:true }............................: avg=100.68ms min=89.05ms  med=102.63ms max=108.45ms p(90)=107.72ms p(95)=108.09ms
     ✓ { scenario:eth_syncing,expected_response:true }...............................: avg=103.75ms min=89.58ms  med=91.57ms  max=131.56ms p(90)=125.43ms p(95)=128.49ms
     ✓ { scenario:net_listening,expected_response:true }.............................: avg=104.59ms min=95.49ms  med=101.45ms max=121.25ms p(90)=114.19ms p(95)=117.72ms
     ✓ { scenario:web3_clientVersion,expected_response:true }........................: avg=101.97ms min=95.56ms  med=102.11ms max=106.25ms p(90)=105.89ms p(95)=106.07ms
     http_req_failed.................................................................: 17.15%  ✓ 35       ✗ 169
     http_req_receiving..............................................................: avg=273.53µs min=117µs    med=177µs    max=5.59ms   p(90)=280.7µs  p(95)=326.09µs
     http_req_sending................................................................: avg=165.58µs min=59µs     med=142µs    max=2.98ms   p(90)=239.8µs  p(95)=290.85µs
     http_req_tls_handshaking........................................................: avg=58.37ms  min=45.82ms  med=53.42ms  max=355.69ms p(90)=62.52ms  p(95)=70.56ms
     http_req_waiting................................................................: avg=182.17ms min=88.38ms  med=118.79ms max=2.62s    p(90)=230.12ms p(95)=264.75ms
     http_reqs.......................................................................: 204     0.815748/s
     ✓ { scenario:eth_accounts }.....................................................: 4       0.015995/s
     ✓ { scenario:eth_blockNumber }..................................................: 5       0.019994/s
     ✓ { scenario:eth_call }.........................................................: 3       0.011996/s
     ✓ { scenario:eth_chainId }......................................................: 5       0.019994/s
     ✓ { scenario:eth_coinbase }.....................................................: 5       0.019994/s
     ✓ { scenario:eth_estimateGas }..................................................: 5       0.019994/s
     ✓ { scenario:eth_feeHistory }...................................................: 12      0.047985/s
     ✓ { scenario:eth_gasPrice }.....................................................: 5       0.019994/s
     ✓ { scenario:eth_getBalance }...................................................: 4       0.015995/s
     ✓ { scenario:eth_getBlockByHash }...............................................: 6       0.023993/s
     ✓ { scenario:eth_getBlockByNumber }.............................................: 4       0.015995/s
     ✓ { scenario:eth_getBlockTransactionCountByHash }...............................: 7       0.027991/s
     ✓ { scenario:eth_getBlockTransactionCountByNumber }.............................: 8       0.03199/s
     ✓ { scenario:eth_getCode }......................................................: 5       0.019994/s
     ✓ { scenario:eth_getLogs }......................................................: 4       0.015995/s
     ✓ { scenario:eth_getStorageAt }.................................................: 5       0.019994/s
     ✓ { scenario:eth_getTransactionByBlockHashAndIndex }............................: 5       0.019994/s
     ✓ { scenario:eth_getTransactionByBlockNumberAndIndex }..........................: 4       0.015995/s
     ✓ { scenario:eth_getTransactionByHash }.........................................: 4       0.015995/s
     ✓ { scenario:eth_getTransactionCount }..........................................: 4       0.015995/s
     ✓ { scenario:eth_getTransactionReceipt }........................................: 4       0.015995/s
     ✓ { scenario:eth_getUncleByBlockHashAndIndex }..................................: 6       0.023993/s
     ✓ { scenario:eth_getUncleByBlockNumberAndIndex }................................: 6       0.023993/s
     ✓ { scenario:eth_getUncleCountByBlockHash }.....................................: 6       0.023993/s
     ✓ { scenario:eth_getUncleCountByBlockNumber }...................................: 5       0.019994/s
     ✓ { scenario:eth_getWork }......................................................: 5       0.019994/s
     ✓ { scenario:eth_hashrate }.....................................................: 6       0.023993/s
     ✓ { scenario:eth_mining }.......................................................: 5       0.019994/s
     ✓ { scenario:eth_protocolVersion }..............................................: 5       0.019994/s
     ✓ { scenario:eth_sendRawTransaction }...........................................: 2       0.007998/s
     ✓ { scenario:eth_sendTransaction }..............................................: 5       0.019994/s
     ✓ { scenario:eth_signTransaction }..............................................: 5       0.019994/s
     ✓ { scenario:eth_sign }.........................................................: 5       0.019994/s
     ✓ { scenario:eth_submitHashrate }...............................................: 5       0.019994/s
     ✓ { scenario:eth_submitWork }...................................................: 6       0.023993/s
     ✓ { scenario:eth_syncing }......................................................: 5       0.019994/s
     ✓ { scenario:net_listening }....................................................: 5       0.019994/s
     ✓ { scenario:web3_clientVersion }...............................................: 5       0.019994/s
     iteration_duration..............................................................: avg=292.99ms min=180.91ms med=224.03ms max=2.73s    p(90)=346.76ms p(95)=376.77ms
     iterations......................................................................: 200     0.799753/s
     scenario_duration...............................................................: 1035    min=181    max=5464
     ✓ { scenario:eth_accounts }.....................................................: 1209    min=309    max=1209
     ✓ { scenario:eth_blockNumber }..................................................: 1179    min=242    max=1179
     ✓ { scenario:eth_call }.........................................................: 1122    min=375    max=1122
     ✓ { scenario:eth_chainId }......................................................: 1163    min=197    max=1163
     ✓ { scenario:eth_coinbase }.....................................................: 1119    min=184    max=1119
     ✓ { scenario:eth_estimateGas }..................................................: 1119    min=215    max=1119
     ✓ { scenario:eth_feeHistory }...................................................: 4146    min=335    max=4146
     ✓ { scenario:eth_gasPrice }.....................................................: 1001    min=224    max=1001
     ✓ { scenario:eth_getBalance }...................................................: 1029    min=269    max=1029
     ✓ { scenario:eth_getBlockByHash }...............................................: 2119    min=425    max=2119
     ✓ { scenario:eth_getBlockByNumber }.............................................: 1204    min=303    max=1204
     ✓ { scenario:eth_getBlockTransactionCountByHash }...............................: 1677    min=253    max=1677
     ✓ { scenario:eth_getBlockTransactionCountByNumber }.............................: 2183    min=271    max=2183
     ✓ { scenario:eth_getCode }......................................................: 1211    min=237    max=1211
     ✓ { scenario:eth_getLogs }......................................................: 1331    min=344    max=1331
     ✓ { scenario:eth_getStorageAt }.................................................: 1214    min=253    max=1214
     ✓ { scenario:eth_getTransactionByBlockHashAndIndex }............................: 1182    min=242    max=1182
     ✓ { scenario:eth_getTransactionByBlockNumberAndIndex }..........................: 1160    min=307    max=1160
     ✓ { scenario:eth_getTransactionByHash }.........................................: 1285    min=341    max=1285
     ✓ { scenario:eth_getTransactionCount }..........................................: 4965    min=2128   max=4965
     ✓ { scenario:eth_getTransactionReceipt }........................................: 1023    min=266    max=1023
     ✓ { scenario:eth_getUncleByBlockHashAndIndex }..................................: 1224    min=195    max=1224
     ✓ { scenario:eth_getUncleByBlockNumberAndIndex }................................: 1209    min=191    max=1209
     ✓ { scenario:eth_getUncleCountByBlockHash }.....................................: 1178    min=194    max=1178
     ✓ { scenario:eth_getUncleCountByBlockNumber }...................................: 1035    min=207    max=1035
     ✓ { scenario:eth_getWork }......................................................: 1177    min=188    max=1177
     ✓ { scenario:eth_hashrate }.....................................................: 1191    min=201    max=1191
     ✓ { scenario:eth_mining }.......................................................: 1026    min=189    max=1026
     ✓ { scenario:eth_protocolVersion }..............................................: 1005    min=200    max=1005
     ✓ { scenario:eth_sendRawTransaction }...........................................: 5464    min=2725   max=5464
     ✓ { scenario:eth_sendTransaction }..............................................: 1146    min=220    max=1146
     ✓ { scenario:eth_signTransaction }..............................................: 1097    min=210    max=1097
     ✓ { scenario:eth_sign }.........................................................: 1057    min=191    max=1057
     ✓ { scenario:eth_submitHashrate }...............................................: 1020    min=194    max=1020
     ✓ { scenario:eth_submitWork }...................................................: 1198    min=203    max=1198
     ✓ { scenario:eth_syncing }......................................................: 1001    min=181    max=1001
     ✓ { scenario:net_listening }....................................................: 1015    min=193    max=1015
     ✓ { scenario:web3_clientVersion }...............................................: 1118    min=315    max=1118
     vus.............................................................................: 1       min=0      max=1
     vus_max.........................................................................: 1       min=1      max=1   %

```

Note: disregard the per scenario RPS reported in the `http_reqs` section since it's calculated as the total requests in
a scenario divided by the run time of the test suite.

With the test suite mode, a simplified markdown format report `report.md` will also be generated.

JSON-RPC-RELAY URL: https://previewnet.hashio.io/api

Timestamp: 2023-02-24T22:17:04.051Z

| Scenario                                | VUS | Reqs | Pass % | RPS (1/s) | Pass RPS (1/s) | Avg. Req Duration (ms) | Median (ms) | Min (ms) | Max (ms) | P(90) (ms) | P(95) (ms) | Comment |
| --------------------------------------- | --- | ---- | ------ | --------- | -------------- | ---------------------- | ----------- | -------- | -------- | ---------- | ---------- | ------- |
| eth_accounts                            | 1   | 5    | 100.00 | 4.53      | 4.53           | 100.38                 | 98.79       | 98.76    | 104.00   | 103.03     | 103.51     |         |
| eth_blockNumber                         | 1   | 5    | 100.00 | 4.30      | 4.30           | 134.77                 | 132.85      | 131.78   | 143.47   | 139.61     | 141.54     |         |
| eth_call                                | 1   | 3    | 100.00 | 2.87      | 2.87           | 229.14                 | 263.49      | 89.26    | 334.66   | 320.42     | 327.54     |         |
| eth_chainId                             | 1   | 5    | 100.00 | 4.99      | 4.99           | 102.37                 | 102.72      | 91.55    | 111.75   | 108.49     | 110.12     |         |
| eth_coinbase                            | 1   | 5    | 100.00 | 4.82      | 4.82           | 0.00                   | 0.00        | 0.00     | 0.00     | 0.00       | 0.00       |         |
| eth_estimateGas                         | 1   | 6    | 100.00 | 4.97      | 4.97           | 104.46                 | 102.89      | 93.06    | 120.53   | 115.05     | 117.79     |         |
| eth_feeHistory                          | 1   | 11   | 100.00 | 2.58      | 2.58           | 288.02                 | 216.88      | 207.32   | 951.04   | 255.90     | 603.47     |         |
| eth_gasPrice                            | 1   | 5    | 100.00 | 4.98      | 4.98           | 103.57                 | 102.73      | 97.44    | 109.53   | 108.14     | 108.84     |         |
| eth_getBalance                          | 1   | 5    | 100.00 | 4.14      | 4.14           | 148.01                 | 151.74      | 127.70   | 159.03   | 156.97     | 158.00     |         |
| eth_getBlockByHash                      | 1   | 6    | 100.00 | 2.91      | 2.91           | 244.47                 | 242.17      | 218.85   | 282.63   | 268.42     | 275.52     |         |
| eth_getBlockByNumber                    | 1   | 4    | 100.00 | 3.69      | 3.69           | 174.80                 | 172.27      | 165.09   | 189.59   | 185.05     | 187.32     |         |
| eth_getBlockTransactionCountByHash      | 1   | 17   | 100.00 | 4.20      | 4.20           | 138.03                 | 138.41      | 116.95   | 152.41   | 149.10     | 150.27     |         |
| eth_getBlockTransactionCountByNumber    | 1   | 7    | 100.00 | 3.49      | 3.49           | 185.96                 | 181.94      | 170.07   | 204.35   | 200.33     | 202.34     |         |
| eth_getCode                             | 1   | 3    | 100.00 | 2.82      | 2.82           | 130.03                 | 133.64      | 91.96    | 164.50   | 158.33     | 161.41     |         |
| eth_getLogs                             | 1   | 4    | 100.00 | 2.99      | 2.99           | 235.37                 | 234.37      | 188.35   | 284.38   | 275.97     | 280.17     |         |
| eth_getStorageAt                        | 1   | 5    | 100.00 | 4.21      | 4.21           | 140.11                 | 142.18      | 132.18   | 148.55   | 146.32     | 147.44     |         |
| eth_getTransactionByBlockHashAndIndex   | 1   | 4    | 100.00 | 3.94      | 3.94           | 159.65                 | 162.14      | 135.98   | 178.35   | 175.30     | 176.83     |         |
| eth_getTransactionByBlockNumberAndIndex | 1   | 2    | 100.00 | 3.58      | 3.58           | 177.93                 | 177.93      | 161.57   | 194.28   | 191.01     | 192.65     |         |
| eth_getTransactionByHash                | 1   | 4    | 100.00 | 3.31      | 3.31           | 205.91                 | 202.36      | 194.31   | 224.59   | 220.23     | 222.41     |         |
| eth_getTransactionCount                 | 1   | 7    | 100.00 | 2.29      | 2.29           | 284.26                 | 270.47      | 224.25   | 399.28   | 342.18     | 370.73     |         |
| eth_getTransactionReceipt               | 1   | 4    | 100.00 | 3.87      | 3.87           | 162.93                 | 164.81      | 153.43   | 168.67   | 168.00     | 168.34     |         |
| eth_getUncleByBlockHashAndIndex         | 1   | 5    | 100.00 | 4.78      | 4.78           | 100.16                 | 100.32      | 93.55    | 106.20   | 105.84     | 106.02     |         |
| eth_getUncleByBlockNumberAndIndex       | 1   | 5    | 100.00 | 4.22      | 4.22           | 136.64                 | 107.07      | 93.88    | 262.02   | 204.65     | 233.33     |         |
| eth_getUncleCountByBlockHash            | 1   | 6    | 100.00 | 5.05      | 5.05           | 98.49                  | 97.37       | 93.52    | 105.77   | 104.46     | 105.12     |         |
| eth_getUncleCountByBlockNumber          | 1   | 5    | 100.00 | 4.94      | 4.94           | 106.07                 | 100.91      | 99.06    | 126.72   | 117.39     | 122.05     |         |
| eth_getWork                             | 1   | 5    | 100.00 | 4.93      | 4.93           | 0.00                   | 0.00        | 0.00     | 0.00     | 0.00       | 0.00       |         |
| eth_hashrate                            | 1   | 5    | 100.00 | 4.70      | 4.70           | 107.67                 | 111.80      | 94.83    | 117.48   | 115.46     | 116.47     |         |
| eth_mining                              | 1   | 5    | 100.00 | 4.95      | 4.95           | 104.46                 | 104.68      | 93.57    | 118.11   | 115.51     | 116.81     |         |
| eth_protocolVersion                     | 1   | 5    | 100.00 | 4.95      | 4.95           | 0.00                   | 0.00        | 0.00     | 0.00     | 0.00       | 0.00       |         |
| eth_sendRawTransaction                  | 1   | 2    | 100.00 | 0.39      | 0.39           | 2462.27                | 2462.27     | 2383.88  | 2540.66  | 2524.98    | 2532.82    |         |
| eth_sendTransaction                     | 1   | 5    | 100.00 | 4.85      | 4.85           | 0.00                   | 0.00        | 0.00     | 0.00     | 0.00       | 0.00       |         |
| eth_sign                                | 1   | 3    | 100.00 | 2.33      | 2.33           | 0.00                   | 0.00        | 0.00     | 0.00     | 0.00       | 0.00       |         |
| eth_signTransaction                     | 1   | 6    | 100.00 | 5.10      | 5.10           | 0.00                   | 0.00        | 0.00     | 0.00     | 0.00       | 0.00       |         |
| eth_submitHashrate                      | 1   | 6    | 100.00 | 5.05      | 5.05           | 0.00                   | 0.00        | 0.00     | 0.00     | 0.00       | 0.00       |         |
| eth_submitWork                          | 1   | 5    | 100.00 | 4.84      | 4.84           | 107.37                 | 102.09      | 98.70    | 132.91   | 120.87     | 126.89     |         |
| eth_syncing                             | 1   | 6    | 100.00 | 5.04      | 5.04           | 99.14                  | 99.96       | 90.02    | 109.07   | 105.16     | 107.12     |         |
| net_listening                           | 1   | 5    | 100.00 | 4.80      | 4.80           | 106.01                 | 104.28      | 94.85    | 122.19   | 117.98     | 120.09     |         |
| web3_clientVersion                      | 1   | 6    | 100.00 | 5.09      | 5.09           | 100.09                 | 101.36      | 91.31    | 105.01   | 104.75     | 104.88     |         |

### Single Test

To run a single test, such as the `eth_chainId` test, just add or change ENV variable:

```shell
FILTER_TEST=eth_chainid
```

To run a subset of tests, such as `eth_call` and `eth_sendRawTransaction`, just add or change ENV variable:

```shell
FILTER_TEST=eth_call,eth_sendRawTransaction
```

When it completes, k6 will show a similar summary report. However, only for the selected tests.

## Load Test

To run a load test, just add or change ENV variable:

```shell
TEST_TYPE=load
```

Recommended Parameters when performing Load Tests:

```shell
DEFAULT_DURATION=300s
DEFAULT_VUS=10
DEFAULT_LIMIT=3000
DEFAULT_PASS_RATE=0.90
DEFAULT_MAX_DURATION=1000
DEFAULT_GRACEFUL_STOP=5s
FILTER_TEST=eth_chainId,eth_blockNumber,eth_gasPrice,eth_getBlockByNumber,eth_getCode,eth_call,eth_estimateGas,eth_getBalance,eth_getTransactionCount,eth_feeHistory,eth_getTransactionReceipt,eth_getBlockByHash
DEBUG_MODE=false
SIGNED_TXS=10
TEST_TYPE=load
```

When it completes, k6 will show a similar summary report. However, only for the load tests.
