As an implementation of [HIP 419](https://hips.hedera.com/hip/hip-482), the Hedera JSON RPC Relay provides some [Ethereum JSON-RPC APIs](https://ethereum.github.io/execution-apis/api-documentation/) which implement the [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) to support Ethereum tools interacting with Hedera nodes e.g. wallets, developer tools.

## Requests

Requests to the Relay will take the form of HTTP calls to an endpoints method.
A curl example to the `eth_chainId` takes the form
Request

```shell
  curl ${RELAY_ENDPOINT_URL} -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"2","method":"eth_chainId","params":[null]}'
```

Where

- RELAY_ENDPOINT_URL - HTTP url endpoint, default `http://localhost:7546`

## Result Schema

Result responses can take the form of success or error.

Success Response

```json
{
  "id": 1,
  "jsonrpc": "2.0",
  "result": "0x4b7"
}
```

Error Response

```json
{
  "id": 2,
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}
```

The values can range from regular data types (String, int, array) to defined Ethereum objects such as:

- [Block](https://besu.hyperledger.org/en/stable/Reference/API-Objects/#block-object)
- [Log](https://besu.hyperledger.org/en/stable/Reference/API-Objects/#log-object)
- [Transaction](https://besu.hyperledger.org/en/stable/Reference/API-Objects/#transaction-object)

## Endpoints

The JSON RPC Relay methods implements a subset of the standard method:

- [Gossip Methods](https://ethereum.org/en/developers/docs/apis/json-rpc/#gossip-methods)
- [State Methods](https://ethereum.org/en/developers/docs/apis/json-rpc/#state_methods)
- [History Methods](https://ethereum.org/en/developers/docs/apis/json-rpc/#history_methods)

### Endpoint Tables

Below are comprehensive tables of all Ethereum JSON-RPC methods and additional non-standard methods.

#### Ethereum JSON-RPC Standard Methods

Below is a comprehensive table of all Ethereum JSON-RPC methods from the [Ethereum JSON-RPC API specification](https://ethereum.github.io/execution-apis/docs/reference/json-rpc-api) and [Ethereum JSON-RPC 2.0 specification](https://ethereum.org/en/developers/docs/apis/json-rpc/).

| Method                                                                                                                                    | Implementation Status                                     | Hedera Nodes                              | Hedera Specifics                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [eth_accounts](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_accounts)                                                       | **Implemented** - Returns `[]`                            | N/A                                       | Always returns empty array per Infura behavior                                                                                            |
| [eth_blobBaseFee](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_blobBaseFee)                                                 | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | EIP-4844 blob transactions not supported                                                                                                  |
| [eth_blockNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_blocknumber)                                                 | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_call](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_call)                                                               | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_chainId](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_chainid)                                                         | **Implemented**                                           | N/A                                       | Returns configured chain ID from environment                                                                                              |
| [eth_coinbase](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_coinbase)                                                       | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Fixed zero address as Hedera has no traditional coinbase                                                                                  |
| [eth_createAccessList](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_createaccesslist)                                       | **Not Implemented** - Returns `-32601` (Method not found) | N/A                                       |                                                                                                                                           |
| [eth_estimateGas](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_estimategas)                                                 | **Implemented**                                           | Mirror Node                               | Uses mirror node gas estimation                                                                                                           |
| [eth_feeHistory](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_feehistory)                                                   | **Implemented**                                           | Mirror Node                               | Returns Hedera gas prices and utilization data                                                                                            |
| [eth_gasPrice](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gasprice)                                                       | **Implemented**                                           | Mirror Node                               | Returns current Hedera gas price in tinybars converted to wei                                                                             |
| [eth_getBalance](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getbalance)                                                   | **Implemented**                                           | Mirror Node                               | Returns HBAR balance converted to wei                                                                                                     |
| [eth_getBlockByHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblockbyhash)                                           | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getBlockByNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblocknumber)                                         | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getBlockReceipts](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblockreceipts)                                       | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getBlockTransactionCountByHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblocktransactioncountbyhash)           | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getBlockTransactionCountByNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblocktransactioncountbynumber)       | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getCode](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getcode)                                                         | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getFilterChanges](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getfilterchanges)                                       | **Implemented**                                           | Mirror Node                               | Filter state stored in configurable cache (LRU or Redis)                                                                                  |
| [eth_getFilterLogs](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getfilterlogs)                                             | **Implemented**                                           | Mirror Node                               | Filter state stored in configurable cache (LRU or Redis)                                                                                  |
| [eth_getLogs](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getlogs)                                                         | **Implemented**                                           | Mirror Node                               | Subject to Mirror Node query limits                                                                                                       |
| [eth_getProof](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getproof)                                                       | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Merkle proofs not supported                                                                                                               |
| [eth_createAccessList](https://ethereum.github.io/execution-apis/docs/reference/eth_createaccesslist)                                     | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Generates an access list for a transaction                                                                                                |
| [eth_getStorageAt](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getstorageat)                                               | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getTransactionByBlockHashAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionbyblockhashandindex)     | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getTransactionByBlockNumberAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionbyblocknumberandindex) | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getTransactionByHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionbyhash)                               | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getTransactionCount](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactioncount)                                 | **Implemented**                                           | Mirror Node                               | Returns account nonce                                                                                                                     |
| [eth_getTransactionReceipt](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionreceipt)                             | **Implemented**                                           | Mirror Node                               |                                                                                                                                           |
| [eth_getUncleByBlockHashAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclebyblockhashandindex)                 | **Implemented** - Returns `null`                          | N/A                                       | No uncle blocks in Hedera                                                                                                                 |
| [eth_getUncleByBlockNumberAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclebyblocknumberandindex)             | **Implemented** - Returns `null`                          | N/A                                       | No uncle blocks in Hedera                                                                                                                 |
| [eth_getUncleCountByBlockHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclecountbyblockhash)                       | **Implemented** - Returns `0x0`                           | N/A                                       | No uncle blocks in Hedera                                                                                                                 |
| [eth_getUncleCountByBlockNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclecountbyblocknumber)                   | **Implemented** - Returns `0x0`                           | N/A                                       | No uncle blocks in Hedera                                                                                                                 |
| [eth_getWork](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getwork)                                                         | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Mining not applicable to Hedera                                                                                                           |
| [eth_hashrate](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_hashrate)                                                       | **Implemented** - Returns `0x0`                           | N/A                                       | Mining not applicable to Hedera                                                                                                           |
| [eth_maxPriorityFeePerGas](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_maxpriorityfeepergas)                               | **Implemented** - Returns `0x0`                           | N/A                                       | Returns same value as gasPrice since Hedera doesn't have priority fees                                                                    |
| [eth_mining](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_mining)                                                           | **Implemented** - Returns `false`                         | N/A                                       | Mining not applicable to Hedera                                                                                                           |
| [eth_newBlockFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_newblockfilter)                                           | **Implemented**                                           | Mirror Node                               | Filter state stored in configurable cache (LRU or Redis)                                                                                  |
| [eth_newFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_newfilter)                                                     | **Implemented**                                           | Mirror Node                               | Filter state stored in configurable cache (LRU or Redis)                                                                                  |
| [eth_newPendingTransactionFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_newpendingtransactionfilter)                 | **Implemented**                                           | Mirror Node                               | Filter state stored in configurable cache (LRU or Redis)                                                                                  |
| [eth_protocolVersion](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_protocolversion)                                         | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Not supported on Hedera                                                                                                                   |
| [eth_sendRawTransaction](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sendrawtransaction)                                   | **Implemented**                                           | Consensus Node, Mirror Node               | Submits to Consensus Node, polls Mirror Node for confirmation                                                                             |
| [eth_sendTransaction](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sendtransaction)                                         | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Account management not supported                                                                                                          |
| [eth_sign](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sign)                                                               | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Account management not supported                                                                                                          |
| [eth_signTransaction](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_signtransaction)                                         | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Account management not supported                                                                                                          |
| [eth_signTypedData](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_signtypeddata)                                             | **Implemented** - Returns `-32601` (Method not found)     | N/A                                       | Account management not supported                                                                                                          |
| [eth_simulateV1](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_simulatev1)                                                   | **Not Implemented**                                       | N/A                                       |                                                                                                                                           |
| [eth_submitHashrate](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_submithashrate)                                           | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Mining not applicable to Hedera                                                                                                           |
| [eth_submitWork](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_submitwork)                                                   | **Implemented** - Returns `false`                         | N/A                                       | Mining not applicable to Hedera                                                                                                           |
| [eth_syncing](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_syncing)                                                         | **Implemented** - Returns `false`                         | N/A                                       | Hedera network is always synced                                                                                                           |
| [eth_uninstallFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_uninstallfilter)                                         | **Implemented**                                           | N/A                                       | Filter state stored in configurable cache (LRU or Redis)                                                                                  |
| [net_listening](https://ethereum.org/en/developers/docs/apis/json-rpc/#net_listening)                                                     | **Implemented** - Returns `true`                          | N/A                                       | Relay always returns true for this                                                                                                        |
| [net_peerCount](https://ethereum.org/en/developers/docs/apis/json-rpc/#net_peercount)                                                     | **Implemented** - Returns `-32601` (Method not supported) | N/A                                       | Relay doesn't maintain peer connections                                                                                                   |
| [net_version](https://ethereum.org/en/developers/docs/apis/json-rpc/#net_version)                                                         | **Implemented**                                           | N/A                                       | Returns configured chain ID as string                                                                                                     |
| [web3_clientVersion](https://ethereum.org/en/developers/docs/apis/json-rpc/#web3_clientversion)                                           | **Implemented**                                           | N/A                                       | Returns relay version information                                                                                                         |
| [web3_sha3](https://ethereum.org/en/developers/docs/apis/json-rpc/#web3_sha3)                                                             | **Implemented**                                           | N/A                                       | Computes Keccak-256 hash locally                                                                                                          |

#### Non-Standard / Extended Methods

These methods are extensions provided by various Ethereum clients but are not part of the core Ethereum JSON-RPC specification.

| Method                                                                                                                | Implementation Status                                                            | Hedera Nodes | Hedera Specifics                                       |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------ |
| [admin_config](https://github.com/hiero-ledger/hiero-json-rpc-relay/tree/main#admin-api)                              | **Implemented**                                                                  | N/A          | Returns relay and upstream dependency configuration    |
| [debug_getBadBlocks](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debuggetbadblocks)             | **Implemented** - Requires `DEBUG_API_ENABLED=true`                              | N/A          | Always returns empty array                             |
| [debug_getRawBlock](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debuggetrawblock)               | **Not Implemented**                                                              | N/A          |                                                        |
| [debug_getRawHeader](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debuggetrawheader)             | **Not Implemented**                                                              | N/A          |                                                        |
| [debug_getRawReceipts](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debuggetrawreceipts)         | **Not Implemented**                                                              | N/A          |                                                        |
| [debug_getRawTransaction](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debuggetrawtransaction)   | **Not Implemented**                                                              | N/A          |                                                        |
| [debug_traceBlockByHash](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debugtraceblockbyhash)     | **Implemented** - Requires `DEBUG_API_ENABLED=true`                              | Mirror Node  | Supports CallTracer and PrestateTracer, caches results |
| [debug_traceBlockByNumber](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debugtraceblockbynumber) | **Implemented** - Requires `DEBUG_API_ENABLED=true`                              | Mirror Node  | Supports CallTracer and PrestateTracer, caches results |
| [debug_traceTransaction](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-debug#debugtracetransaction)     | **Implemented** - Requires `DEBUG_API_ENABLED=true`                              | Mirror Node  | Supports CallTracer and OpcodeLogger tracers           |
| [engine\_\*](https://github.com/ethereum/execution-apis/blob/main/src/engine/openrpc/methods/capabilities.yaml)       | **Implemented** - Returns `-32601` (Method not supported) for all engine methods | N/A          | Engine API not applicable to Hedera                    |
| [trace_block](https://openethereum.github.io/JSONRPC-trace-module#trace_block)                                        | **Not Implemented**                                                              | N/A          |                                                        |
| [trace_blockByNumber](https://openethereum.github.io/JSONRPC-trace-module#trace_blockbynumber)                        | **Not Implemented**                                                              | N/A          |                                                        |
| [trace_transaction](https://openethereum.github.io/JSONRPC-trace-module#trace_transaction)                            | **Not Implemented**                                                              | N/A          |                                                        |
| [txpool_content](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool#txpool-content)                   | **Implemented** - Requires `TXPOOL_API_ENABLED=true` and `ENABLE_TX_POOL=true`   | N/A          |                                                        |
| [txpool_contentFrom](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool#txpool-contentfrom)           | **Implemented** - Requires `TXPOOL_API_ENABLED=true` and `ENABLE_TX_POOL=true`   | N/A          |                                                        |
| [txpool_status](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-txpool#txpool-status)                     | **Implemented** - Requires `TXPOOL_API_ENABLED=true` and `ENABLE_TX_POOL=true`   | N/A          |                                                        |

### Live events API

Details for the Real-Time Events API can be found [here](./live-events-api.md)

### Open RPC Spec

The detailed schema specifications of the current methods offerred by the JSON RPC relay is captured in our
[Open RPC Specification](https://playground.open-rpc.org/?schemaUrl=https://raw.githubusercontent.com/hiero-ledger/hiero-json-rpc-relay/main/docs/openrpc.json&uiSchema%5BappBar%5D%5Bui:splitView%5D=false&uiSchema%5BappBar%5D%5Bui:input%5D=false&uiSchema%5BappBar%5D%5Bui:examplesDropdown%5D=false)
