# Configuration

The packages of the JSON RPC Relay support loading of configuration from an `.env` file or via the
environment.

## Default Values

The default configuration allows users to quickly get up and running without having to configure anything. This provides
ease of use at the trade-off of some insecure default configuration. Most configuration settings have appropriate
defaults and can be left unchanged. It is recommended to browse the properties below and adjust to your needs.

A few properties omit a default value as they relate to account information and Hedera environment details.
These properties are noted below and should be custom set per deployment.

- `CHAIN_ID`
- `HEDERA_NETWORK`
- `MIRROR_NODE_URL`
- `OPERATOR_ID_MAIN`
- `OPERATOR_KEY_MAIN`
- `SERVER_PORT`

**Note**: The default logging level in the TypeScript application is set to trace.

## Relay

The following table lists the available properties along with their default values for the [Relay package](/packages/relay/).
Unless you need to set a non-default value, it is recommended to only populate overridden properties in the custom `.env`.

| Name                                        | Default                               | Description                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CACHE_MAX`                                 | "1000"                                | The maximum number (or size) of items that remain in the cache (assuming no TTL pruning or explicit deletions).                                                                                                                                                                                        |
| `CACHE_TTL`                                 | "3_600_000"                           | Max time to live in ms, for items before they are considered stale. Default is one hour in milliseconds                                                                                                                                                                                                |
| `CLIENT_TRANSPORT_SECURITY`                 | "false"                               | Flag to enable or disable TLS for both networks.                                                                                                                                                                                                                                                       |
| `CONSENSUS_MAX_EXECUTION_TIME`              | "15000"                               | Maximum time in ms the SDK will wait when submitting a transaction/query before throwing a TIMEOUT error.                                                                                                                                                                                              |
| `CONTRACT_CALL_GAS_LIMIT`                   | "50_000_000"                          | Maximum gas limit applied to eth_call endpoint networks, the Relay will accept up to 50M but keep it capped at 15M for the actual call.                                                                                                                                                                |
| `CONTRACT_QUERY_TIMEOUT_RETRIES`            | "3"                                   | Maximum retries for failed contract call query with timeout exceeded error                                                                                                                                                                                                                             |
| `DEBUG_API_ENABLED`                         | "false"                               | Enables all debug related methods: `debug_traceTransaction`                                                                                                                                                                                                                                            |
| `DEFAULT_RATE_LIMIT`                        | "200"                                 | default fallback rate limit, if no other is configured.                                                                                                                                                                                                                                                |
| `ESTIMATE_GAS_THROWS`                       | "true"                                | Flag to determine if the system should throw an error with the actual reason during contract reverts instead of returning a predefined gas value.                                                                                                                                                      |
| `ETH_BLOCK_NUMBER_CACHE_TTL_MS`             | "1000"                                | Time in ms to cache response from mirror node                                                                                                                                                                                                                                                          |
| `ETH_CALL_ACCEPTED_ERRORS`                  | "[]"                                  | A list of acceptable error codes for eth_call requests. If an error code in this list is returned, the request will be retried.                                                                                                                                                                        |
| `ETH_CALL_CACHE_TTL`                        | "200"                                 | Maximum time in ms to cache an eth_call response.                                                                                                                                                                                                                                                      |
| `ETH_CALL_CONSENSUS_SELECTORS`              | "[]"                                  | A comma-separated list of special transaction selectors that should always be routed to the Consensus node.                                                                                                                                                                                            |
| `ETH_CALL_DEFAULT_TO_CONSENSUS_NODE`        | "false"                               | Flag to set if eth_call logic should first query the mirror node.                                                                                                                                                                                                                                      |
| `ETH_FEE_HISTORY_FIXED`                     | "true"                                | Flag to set if eth_feeHistory should return a fixed fee for the set of results.                                                                                                                                                                                                                        |
| `ETH_GET_BALANCE_CACHE_TTL_MS`              | "1000"                                | Time in ms to cache balance returned                                                                                                                                                                                                                                                                   |
| `ETH_GET_BLOCK_BY_RESULTS_BATCH_SIZE`       | "25"                                  | The number of contract results to request from the Mirror Node per batch durin an eth_getBlockByHash or eth_getBlockByNumber call                                                                                                                                                                      |
| `ETH_GET_GAS_PRICE_CACHE_TTL_MS`            | "1_800_000"                           | Time in ms to cache ethGasPrice returned                                                                                                                                                                                                                                                               |
| `ETH_GET_LOGS_BLOCK_RANGE_LIMIT`            | "1000"                                | The maximum block number range to consider during an eth_getLogs call.                                                                                                                                                                                                                                 |
| `ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE` | "1000"                                | The maximum number of transactions to return when running eth_getBlockByHash or eth_getBlockByNumber with transaction objects set to true call.                                                                                                                                                        |
| `FEE_HISTORY_MAX_RESULTS`                   | "10"                                  | The maximum number of results to returns as part of `eth_feeHistory`.                                                                                                                                                                                                                                  |
| `FILE_APPEND_CHUNK_SIZE=5120`               | "5120"                                | Size in bytes of file chunks for the `HAPI` `FileAppendTransaction` to use during contract creation submissions to consensus nodes as part of `eth_sendRawTransactionsaction`.                                                                                                                         |
| `FILE_APPEND_MAX_CHUNKS`                    | "20"                                  | Default maximum number of chunks for the `HAPI` `FileAppendTransaction` to use during contract creation submissions to consensus nodes as part of `eth_sendRawTransactionsaction`.                                                                                                                     |
| `FILTER_API_ENABLED`                        | "true"                                | Enables all filter related methods: `eth_newFilter`, `eth_uninstallFilter`, `eth_getFilterChanges`, `eth_getFilterLogs`, `eth_newBlockFilter`                                                                                                                                                          |
| `GAS_PRICE_PERCENTAGE_BUFFER`               | "0"                                   | The additional buffer that adds a percentage on top of the calculated network gasPrice. This may be used by operators to reduce the chances of `INSUFFICIENT_TX_FEE` errors experienced by users caused by minor fluctuations in the exchange rate.                                                    |
| `GAS_PRICE_TINY_BAR_BUFFER`                 | "10000000000"                         | The additional buffer range to allow during a relay precheck of gas price. This supports slight fluctuations in network gasprice calculations.                                                                                                                                                         |
| `GET_RECORD_DEFAULT_TO_CONSENSUS_NODE`      | "false"                               | Flag to set if get transaction record logic should first query the mirror node (false) or consensus node via the SDK (true).                                                                                                                                                                           |
| `HAPI_CLIENT_DURATION_RESET`                | "3600000"                             | Time until client reinitialization. (ms)                                                                                                                                                                                                                                                               |
| `HAPI_CLIENT_ERROR_RESET`                   | [21, 50]                              | Array of status codes, which when encountered will trigger a reinitialization. Status codes are availble [here](https://github.com/hashgraph/hedera-protobufs/blob/main/services/response_code.proto).                                                                                                 |
| `HAPI_CLIENT_TRANSACTION_RESET`             | "50"                                  | Number of transaction executions, until client reinitialization.                                                                                                                                                                                                                                       |
| `HBAR_RATE_LIMIT_BASIC`                     | "1120000000"                          | Individual limit (in tinybars) for spending plans with a BASIC tier. Defaults to 11.2 HBARs.                                                                                                                                                                                                           |
| `HBAR_RATE_LIMIT_DURATION`                  | "86400000"                            | HBAR budget limit duration. This creates a timestamp, which resets all limits, when it's reached. Defaults to 1 day.                                                                                                                                                                                   |
| `HBAR_RATE_LIMIT_EXTENDED`                  | "3200000000"                          | Individual limit (in tinybars) for spending plans with a EXTENDED tier. Defaults to 32 HBARs.                                                                                                                                                                                                          |
| `HBAR_RATE_LIMIT_PRIVILEGED`                | "8000000000"                          | Individual limit (in tinybars) for spending plans with a PRIVILEGED tier. Defaults to 80 HBARs.                                                                                                                                                                                                        |
| `HBAR_RATE_LIMIT_TINYBAR`                   | "800000000000"                        | Total HBAR budget (in tinybars). Defaults to 8000 HBARs.                                                                                                                                                                                                                                               |
| `HBAR_SPENDING_PLANS_CONFIG`                | "spendingPlansConfig.json"            | The environment variable that either points to a file containing the spending plans, or the JSON content defining the spending plans.                                                                                                                                                                  |
| `HEDERA_SPECIFIC_REVERT_STATUSES`           | ["WRONG_NONCE", "INVALID_ACCOUNT_ID"] | A list of specific transaction statuses where each one identifies that the transaction hadn't been executed in the evm but it had reached the services.                                                                                                                                                |
| `LIMIT_DURATION`                            | "60000"                               | The maximum duration in ms applied to IP-method based rate limits.                                                                                                                                                                                                                                     |
| `MIRROR_NODE_AGENT_CACHEABLE_DNS`           | "true"                                | Flag to set if the mirror node agent should cacheable DNS lookups, using better-lookup library.                                                                                                                                                                                                        |
| `MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX`  | "200"                                 | The maximum number of pages to be requested for contract results logs from the mirror node. (each page will contain a max of 100 results)                                                                                                                                                              |
| `MIRROR_NODE_CONTRACT_RESULTS_PG_MAX`       | "25"                                  | The maximum number of pages to be requested for contract results from the mirror node.                                                                                                                                                                                                                 |
| `MIRROR_NODE_HTTP_KEEP_ALIVE`               | true                                  | Flag indicating whether to keep HTTP connections alive for requests to the mirror node.                                                                                                                                                                                                                |
| `MIRROR_NODE_HTTP_KEEP_ALIVE_MSECS`         | 1000                                  | The maximum time in milliseconds to keep HTTP connections alive for requests to the mirror node.                                                                                                                                                                                                       |
| `MIRROR_NODE_HTTP_MAX_SOCKETS`              | 300                                   | The maximum number of sockets to be used for HTTP connections to the mirror node.                                                                                                                                                                                                                      |
| `MIRROR_NODE_HTTP_MAX_TOTAL_SOCKETS`        | 300                                   | The maximum number of total sockets to be used for HTTP connections to the mirror node.                                                                                                                                                                                                                |
| `MIRROR_NODE_LIMIT_PARAM`                   | "100"                                 | The mirror node custom limit value to be set on GET requests. This optimizes the flow to reduce the number of calls made to the mirror node by setting a limit larger than it's default limit.                                                                                                         |
| `MIRROR_NODE_MAX_REDIRECTS`                 | 5                                     | The maximum number of redirects allowed when making requests to the mirror node before timing out.                                                                                                                                                                                                     |
| `MIRROR_NODE_REQUEST_RETRY_COUNT`           | "10"                                  | Maximun amount of retries to repeat on `GetContractResults` `contracts/results/)` requests when fetching contract results after eth_sendRawTransaction submission. \*Note that this in addition and multiplies the configured Axios retries values.                                                    |
| `MIRROR_NODE_RETRIES`                       | "0"                                   | The maximum number of retries on a GET request to the mirror node when an acceptable error code is returned.                                                                                                                                                                                           |
| `MIRROR_NODE_RETRIES_DEVMODE`               | "5"                                   | The maximum number of retries on a GET request to the mirror node when an acceptable error code is returned in dev mode.                                                                                                                                                                               |
| `MIRROR_NODE_RETRY_CODES`                   | "[]"                                  | The acceptable error codes to retry on a request to the mirror node. If more than 1 error is defined value should be like ie: [400,404,500]                                                                                                                                                            |
| `MIRROR_NODE_RETRY_DELAY`                   | "2000"                                | The delay in ms between retry requests.                                                                                                                                                                                                                                                                |
| `MIRROR_NODE_RETRY_DELAY_DEVMODE`           | "200"                                 | The delay in ms between retry requests in dev mode.                                                                                                                                                                                                                                                    |
| `MIRROR_NODE_TIMEOUT`                       | 1000                                  | The maximum time in ms to wait for a response from the mirror node before timing out.                                                                                                                                                                                                                  |
| `MIRROR_NODE_URL`                           | ""                                    | The Mirror Node API endpoint. Official endpoints are Previewnet (https://previewnet.mirrornode.hedera.com), Testnet (https://testnet.mirrornode.hedera.com), Mainnet (https://mainnet-public.mirrornode.hedera.com). See [Mirror Node REST API](https://docs.hedera.com/hedera/sdks-and-apis/rest-api) |
| `MIRROR_NODE_URL_HEADER_X_API_KEY`          | ""                                    | Authentication for a `MIRROR_NODE_URL` that requires authentication via the `x-api-key` header.                                                                                                                                                                                                        |
| `MULTI_SET`                                 | "false"                               | Switch between different implementation of setting multiple K/V pairs in the shared cache. True is mSet, false is pipeline                                                                                                                                                                             |
| `REDIS_ENABLED`                             | "true"                                | Enable usage of Redis as shared cache                                                                                                                                                                                                                                                                  |
| `REDIS_RECONNECT_DELAY_MS`                  | "1000"                                | Sets the delay between reconnect retries from the Redis client in ms                                                                                                                                                                                                                                   |
| `REDIS_URL`                                 | "redis://127.0.0.1:6379"              | Sets the url for the Redis shared cache                                                                                                                                                                                                                                                                |
| `SDK_REQUEST_TIMEOUT`                       | "10000"                               | The complete timeout for running the SDK `execute()` method. This controls the GRPC channel timeout config when querying with network nodes.                                                                                                                                                           |
| `SEND_RAW_TRANSACTION_SIZE_LIMIT`           | "131072"                              | Sets the limit of the transaction size the relay accepts on eth_sendRawTransaction                                                                                                                                                                                                                     |
| `TEST_GAS_PRICE_DEVIATION`                  | "0.2"                                 | The additional buffer range to allow during a relay precheck of gas price. This supports slight fluctuations in network gasprice calculations.                                                                                                                                                         |
| `TEST_INITIAL_ACCOUNT_STARTING_BALANCE`     | "2000"                                | The number of HBars to allocate to the initial account in acceptance test runs. This account is responsible for the gas payment of tests within the suite run session and needs to be adequately funded.                                                                                               |
| `TIER_1_RATE_LIMIT`                         | "100"                                 | Maximum restrictive request count limit used for expensive endpoints rate limiting.                                                                                                                                                                                                                    |
| `TIER_2_RATE_LIMIT`                         | "800"                                 | Maximum moderate request count limit used for non expensive endpoints.                                                                                                                                                                                                                                 |
| `TIER_3_RATE_LIMIT`                         | "1600"                                | Maximum relaxed request count limit used for static return endpoints.                                                                                                                                                                                                                                  |
| `TX_DEFAULT_GAS`                            | "400000"                              | Default gas for transactions that do not specify gas.                                                                                                                                                                                                                                                  |
| `USE_ASYNC_TX_PROCESSING`                   | "true"                                | Set to `true` to enable `eth_sendRawTransaction` to return the transaction hash immediately after passing all prechecks, while processing the transaction asynchronously in the background.                                                                                                            |
| `MAX_TRANSACTION_FEE_THRESHOLD`             | "15000000"                            | Used to set the max transaction fee. This is the HAPI fee which is paid by the relay operator account.                                                                                                                                                                                                 |

## Server

The following table lists the available properties along with their default values for the [Server package](/packages/server/).
Unless you need to set a non-default value, it is recommended to only populate overridden properties in the custom `.env`.

| Name                                | Default                                                                                                                                                                  | Description                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BATCH_REQUESTS_DISALLOWED_METHODS` | ["debug_traceTransaction", "eth_newFilter", "eth_uninstallFilter", "eth_getFilterChanges", "eth_getFilterLogs", "eth_newBlockFilter", "eth_newPendingTransactionFilter"] | A list of the methods that are not allowed for batch.                                                                                                                                                                             |
| `BATCH_REQUESTS_ENABLED`            | "true"                                                                                                                                                                   | Flag to disable or enable batch requests.                                                                                                                                                                                         |
| `BATCH_REQUESTS_MAX_SIZE`           | "100"                                                                                                                                                                    | Maximum number of requests allowed in a batch.                                                                                                                                                                                    |
| `CHAIN_ID`                          | ""                                                                                                                                                                       | The network chain id. Local and previewnet envs should use `0x12a` (298). Previewnet, Testnet and Mainnet should use `0x129` (297), `0x128` (296) and `0x127` (295) respectively.                                                 |
| `HEDERA_NETWORK`                    | ""                                                                                                                                                                       | Which network to connect to. Automatically populates the main node & mirror node endpoints. Can be `previewnet`, `testnet`, `mainnet` or a map of network IPs -> node accountIds e.g. `{"127.0.0.1:50211":"0.0.3"}`               |
| `INPUT_SIZE_LIMIT`                  | "1mb"                                                                                                                                                                    | The [koa-jsonrpc](https://github.com/Bitclimb/koa-jsonrpc) maximum size allowed for requests                                                                                                                                      |
| `LOG_LEVEL                   `      | "trace"                                                                                                                                                                  | The logging level for the application. Valid values are `trace`, `debug`, `info`, `warn`, `error`, and `fatal`.                                                                                                                   |
| `MAX_BLOCK_RANGE`                   | "5"                                                                                                                                                                      | The maximum block number greater than the mirror node's latest block to query for                                                                                                                                                 |
| `OPERATOR_ID_MAIN`                  | ""                                                                                                                                                                       | Operator account ID used to pay for transactions. In `S.R.N` format, e.g. `0.0.1001`.                                                                                                                                             |
| `OPERATOR_KEY_FORMAT`               | "DER"                                                                                                                                                                    | Operator private key format. Valid types are `DER`, `HEX_ECDSA`, or `HEX_ED25519`                                                                                                                                                 |
| `OPERATOR_KEY_MAIN`                 | ""                                                                                                                                                                       | Operator private key used to sign transactions in hex encoded DER format. This may be either an ED22519 private key or an ECDSA private key. The private key must be associated with/used to derive `OPERATOR_ID_MAIN`.           |
| `RATE_LIMIT_DISABLED`               | "false"                                                                                                                                                                  | Flag to disable IP based rate limiting.                                                                                                                                                                                           |
| `REQUEST_ID_IS_OPTIONAL`            | "false"                                                                                                                                                                  | Flag to set it the JSON RPC request id field in the body should be optional. Note, this breaks the API spec and is not advised and is provided for test purposes only where some wallets may be non compliant                     |
| `SERVER_HOST`                       | undefined                                                                                                                                                                | The hostname or IP address on which the server listens for incoming connections. If `SERVER_HOST` is not configured or left undefined (same as `0.0.0.0`), it permits external connections by default, offering more flexibility. |
| `SERVER_PORT`                       | "7546"                                                                                                                                                                   | The RPC server port number to listen for requests on. Currently a static value defaulting to 7546. See [#955](https://github.com/hashgraph/hedera-json-rpc-relay/issues/955)                                                      |
| `SERVER_REQUEST_TIMEOUT_MS`         | "60000"                                                                                                                                                                  | The time of inactivity allowed before a timeout is triggered and the socket is closed. See [NodeJs Server Timeout](https://nodejs.org/api/http.html#serversettimeoutmsecs-callback)                                               |

## WS-Server

The following table lists the available properties along with their default values for the [Ws-server package](/packages/ws-server/).
Unless you need to set a non-default value, it is recommended to only populate overridden properties in the custom `.env`.

| Name                            | Default     | Description                                                                                                                                                                                                                                 |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUBSCRIPTIONS_ENABLED`         | "false"     | If enabled eth_subscribe will be enabled using WebSockets.                                                                                                                                                                                  |
| `WEB_SOCKET_HOST`               | "localhost" | The hostname or IP address on which the server will listen for incoming connections.                                                                                                                                                        |
| `WEB_SOCKET_HTTP_PORT`          | "8547"      | Port for standard http server, used for metrics and health status endpoints                                                                                                                                                                 |
| `WEB_SOCKET_PORT`               | "8546"      | Port for the web socket connections                                                                                                                                                                                                         |
| `WS_BATCH_REQUESTS_ENABLED`     | "true"      | Flag to disable or enable batch requests on the websocket server.                                                                                                                                                                           |
| `WS_BATCH_REQUESTS_MAX_SIZE`    | "20"        | Maximum number of requests allowed in a batch on websocket server.                                                                                                                                                                          |
| `WS_CACHE_TTL`                  | "20000"     | The time to live for cached entries.                                                                                                                                                                                                        |
| `WS_CONNECTION_LIMIT`           | "10"        | Maximum amount of concurrent web socket connections allowed.                                                                                                                                                                                |
| `WS_CONNECTION_LIMIT_PER_IP`    | "10"        | Maximum amount of connections from a single IP address                                                                                                                                                                                      |
| `WS_MAX_INACTIVITY_TTL`         | "300000"    | Time in ms that the web socket connection is allowed to stay open without any messages sent or received, currently 5 minutes.                                                                                                               |
| `WS_MULTIPLE_ADDRESSES_ENABLED` | "false"     | If enabled eth_subscribe will allow subscription to multiple contract address.                                                                                                                                                              |
| `WS_NEW_HEADS_ENABLED`.         | "true"      | Enables subscriptions for the latest blocks, `newHeads`.                                                                                                                                                                                    |
| `WS_PING_INTERVAL`              | "100000"    | Interval between ping messages. Set to `0` to disable pinger.                                                                                                                                                                               |
| `WS_POLLING_INTERVAL`           | "500"       | Time in ms in between each poll to mirror node while there are subscriptions.                                                                                                                                                               |
| `WS_SAME_SUB_FOR_SAME_EVENT`    | "true"      | The relay will return the same subscription ID when a client subscribes to the same event multiple times using a single connection. When set to false, the relay will always create a new subscription ID for each `eth_subscribe` request. |
| `WS_SUBSCRIPTION_LIMIT`         | "10"        | Maximum amount of subscriptions per single connection                                                                                                                                                                                       |

## Sample for connecting to Hedera Environments

**Hedera Mainnet**

```.env
HEDERA_NETWORK=mainnet
OPERATOR_ID_MAIN=<...redacted...>
OPERATOR_KEY_MAIN=<...redacted...>
CHAIN_ID=0x127
MIRROR_NODE_URL=https://mainnet-public.mirrornode.hedera.com/
```

See [`.env.mainnet.sample`](./examples/.env.mainnet.sample).

**Hedera Testnet**

```.env
HEDERA_NETWORK=testnet
OPERATOR_ID_MAIN=<...redacted...>
OPERATOR_KEY_MAIN=<...redacted...>
CHAIN_ID=0x128
MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com/
```

See [`.env.testnet.sample`](./examples/.env.testnet.sample).

**Hedera Previewnet**

```.env
HEDERA_NETWORK=previewnet
OPERATOR_ID_MAIN=<...redacted...>
OPERATOR_KEY_MAIN=<...redacted...>
CHAIN_ID=0x129
MIRROR_NODE_URL=https://previewnet.mirrornode.hedera.com/
```

See [`.env.previewnet.sample`](./examples/.env.previewnet.sample).

- **_NOTE:_** Replace the redacted operator ID and keys with your own.
- **_NOTE 2:_** Default values for all other keys are sufficient, no need to set them.
- **_NOTE 3:_** The above files have been provided for your convenience within the examples directory of this repo. For example, for the Hedera Testnet configuration, run this command in the root directory of this project: `cp ./docs/examples/.env.testnet.sample ./.env`

## Testing

The following table lists the available properties along with their default values for the tests utilized in the [Server](/packages/server/) and [Relay](/packages/relay/) packages.
Unless you need to set a non-default value, it is recommended to only populate overridden properties in the custom `.env`.

| Name                                     | Default | Description                                                                                        |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `DEV_MODE`                               | "false" | Flag if relay should operate in developer optimization mode.                                       |
| `E2E_RELAY_HOST`                         | ""      | Remote relay url to point to.                                                                      |
| `LOCAL_NODE`                             | ""      | Flag if relay is hosted in the Hedera local node setup.                                            |
| `TEST_GAS_PRICE_DEVIATION`               | 0.2     | Value to use as deviation when comparing gas prices in the rpc-batch1.spec.ts                      |
| `TEST_TRANSACTION_RECORD_COST_TOLERANCE` | 0.02    | Defines the acceptable tolerance level for discrepancies in transaction record costs during tests. |
| `TEST_WS_SERVER`                         | "false" | Flag config for enable or disable the WS server tests.                                             |

For test context additional fields need to be set. The following example showcases a `hedera-local-node` instance (where values match those noted on [Local Node Network Variables](https://github.com/hashgraph/hedera-local-node#network-variables)

```.env
HEDERA_NETWORK={"127.0.0.1:50211":"0.0.3"}
OPERATOR_ID_MAIN=0.0.2
OPERATOR_KEY_MAIN=302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137
CHAIN_ID=0x12a
MIRROR_NODE_URL=http://127.0.0.1:5551
LOCAL_NODE=true
SERVER_PORT=7546
E2E_RELAY_HOST=http://127.0.0.1:7546
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
REDIS_RECONNECT_DELAY_MS=1000
DEFAULT_RATE_LIMIT: 200
TIER_1_RATE_LIMIT: 100
TIER_2_RATE_LIMIT: 800
TIER_3_RATE_LIMIT: 1600
LIMIT_DURATION = 60000
HBAR_RATE_LIMIT_TINYBAR = 11000000000
HBAR_RATE_LIMIT_DURATION = 80000
RATE_LIMIT_DISABLED = false
DEV_MODE = false
GAS_PRICE_TINY_BAR_BUFFER = 10000000000
MIRROR_NODE_RETRIES = 3
MIRROR_NODE_RETRY_DELAY = 2000
MIRROR_NODE_RETRIES_DEVMODE = 5
MIRROR_NODE_RETRY_DELAY_DEVMODE = 200
MIRROR_NODE_LIMIT_PARAM = 100
INPUT_SIZE_LIMIT = 1
ETH_CALL_CACHE_TTL = 200
CONSENSUS_MAX_EXECUTION_TIME = 15000
SDK_REQUEST_TIMEOUT = 10000
CONTRACT_QUERY_TIMEOUT_RETRIES = 3
CONNECTION_LIMIT = 10
CLIENT_TRANSACTION_RESET= 400000
CLIENT_DURATION_RESET= 21600
CLIENT_ERROR_RESET= 100
MAX_CHUNKS=20
TEST_GAS_PRICE_DEVIATION=0.80
TEST_TRANSACTION_RECORD_COST_TOLERANCE=0.05
```

> **_NOTE:_** Acceptance tests can be pointed at a remote locations (previewnet and testnet and custom environments). In this case configuration will require details for remote consensus node gRPC endpoints [previewnet / testnet](https://docs.hedera.com/hedera/networks/testnet/testnet-nodes) / [mainnet](https://docs.hedera.com/hedera/networks/mainnet/mainnet-nodes) and [Mirror Node REST API endpoints](https://docs.hedera.com/hedera/sdks-and-apis/rest-api), be sure to configure `HEDERA_NETWORK` and `MIRROR_NODE_URL` appropriately to point away from your local host and to valid deployed services. When pointing to previewnet and testnet, account Ids (`OPERATOR_ID_MAIN`) and private keys (`OPERATOR_KEY_MAIN`) for previewnet and tests may be obtained from the [Hedera Portal](http://portal.hedera.com).

> **_NOTE 2:_**: Read more about `DEV_MODE` [here](./dev-mode.md)

> **_NOTE 3:_**: Unlike ethereum, Hedera does not allow clients to set their own gas price in order to prioritize their transaction. The price is "published in a fee schedule file, so all Hedera clients pay the same gas price", which helps give Hedera clients predictability in gas costs. Hedera transaction fees are set in fiat(USD) but paid using the gas price in HBAR. The value of HBAR fluctuates with the market so the gas price fluctuates as well. The TEST_GAS_PRICE_DEVIATION allows for a range of gas prices reflecting the current market rates, when testing the current gas price in the acceptance tests. Read more about transaction fees [here](https://hedera.com/fees) and [here](https://hedera.com/blog/pricing-smart-contracts).
