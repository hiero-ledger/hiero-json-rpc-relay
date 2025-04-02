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

### Endpoint Table

Below is a table of provided methods.

| Method                                                                                                                                    | Static Response Value                                                                                | Hedera Nodes (Relay Only, Mirror Node, Consensus Node, Both Nodes) |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [eth_accounts](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_accounts)                                                       | `[]`                                                                                                 | N/A                                                                |
| [eth_blockNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_blocknumber)                                                 | N/A                                                                                                  | Mirror Node                                                        |
| [eth_call](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_call)                                                               | N/A                                                                                                  | Consensus Node                                                     |
| [eth_chainId](https://besu.hyperledger.org/en/stable/Reference/API-Methods/#eth_chainid)                                                  | [Chain_ID](../README.md#configuration)                                                               | Relay Only                                                         |
| [eth_coinbase](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_coinbase)                                                       | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_estimateGas](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_estimategas)                                                 | Generates and returns an estimate of how much gas is necessary to allow the transaction to complete. |
| [eth_feeHistory](https://besu.hyperledger.org/en/stable/Reference/API-Methods/#eth_feehistory)                                            | N/A                                                                                                  | Mirror Node, Consensus Node backup                                 |
| [eth_gasPrice](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gasprice)                                                       | N/A                                                                                                  | Mirror Node, Consensus Node backup                                 |
| [eth_getBalance](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getbalance)                                                   | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getBlockByHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblockbyhash)                                           | Note that `stateRoot` value returned is always zero.                                                 | Mirror Node                                                        |
| [eth_getBlockByNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblockbynumber)                                       | Note that `stateRoot` value returned is always zero.                                                 | Mirror Node                                                        |
| [eth_getBlockTransactionCountByHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblocktransactioncountbyhash)           | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getBlockTransactionCountByNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblocktransactioncountbynumber)       | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getCode](https://besu.hyperledger.org/en/stable/Reference/API-Methods/#eth_getCode)                                                  | N/A                                                                                                  | Mirror Node, Consensus Node backup                                 |
| [eth_getFilterLogs](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getfilterlogs)                                             | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getFilterChanges](https://besu.hyperledger.org/en/stable/Reference/API-Methods/#eth_getfilterchanges)                                | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getLogs](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getlogs)                                                         | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getStorageAt](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getStorageAt)                                               | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getTransactionByBlockHashAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionbyblockhashandindex)     | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getTransactionByBlockNumberAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionbyblocknumberandindex) | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getTransactionByHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionbyhash)                               | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getTransactionCount](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactioncount)                                 | N/A                                                                                                  | Mirror Node, Consensus Node backup                                 |
| [eth_getTransactionReceipt](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionreceipt)                             | N/A                                                                                                  | Mirror Node                                                        |
| [eth_getUncleByBlockHashAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclebyblockhashandindex)                 | `null`                                                                                               | N/A                                                                |
| [eth_getUncleByBlockNumberAndIndex](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclebyblocknumberandindex)             | `null`                                                                                               | N/A                                                                |
| [eth_getUncleCountByBlockHash](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclecountbyblockhash)                       | `null`                                                                                               | N/A                                                                |
| [eth_getUncleCountByBlockNumber](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getunclecountbyblocknumber)                   | `0x0`                                                                                                | N/A                                                                |
| [eth_getWork](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getwork)                                                         | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_hashrate](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_hashrate)                                                       | `0x0`                                                                                                | N/A                                                                |
| [eth_maxPriorityFeePerGas](https://docs.alchemy.com/reference/eth-maxpriorityfeepergas)                                                   | `0x0`                                                                                                | N/A                                                                |
| [eth_mining](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_mining)                                                           | `false`                                                                                              | N/A                                                                |
| [eth_newBlockFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_newblockfilter)                                           | N/A                                                                                                  | N/A                                                                |
| [eth_newFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_newfilter)                                                     | N/A                                                                                                  | N/A                                                                |
| [eth_pendingTransactionFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_newpendingtransactionfilter)                    | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_protocolVersion](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_protocolversion)                                         | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_sendRawTransaction](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sendrawtransaction)                                   | N/A                                                                                                  | Consensus Node                                                     |
| [eth_sendTransaction](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sendtransaction)                                         | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_signTransaction](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_signtransaction)                                         | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_sign](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sign)                                                               | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_submitHashrate](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_submithashrate)                                           | `-32601` (Method not found)                                                                          | N/A                                                                |
| [eth_submitWork](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_submitwork)                                                   | `false`                                                                                              | N/A                                                                |
| [eth_syncing](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_syncing)                                                         | `false`                                                                                              | N/A                                                                |
| [eth_uninstallFilter](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_uninstallfilter)                                         | `true/false`                                                                                         | Relay only                                                         |
| [net_listening](https://ethereum.org/en/developers/docs/apis/json-rpc/#net_listening)                                                     | `false`                                                                                              | N/A                                                                |
| [net_version](https://ethereum.org/en/developers/docs/apis/json-rpc/#net_version)                                                         | [Chain_ID](../README.md#configuration)                                                               | Relay Only                                                         |
| [web3_clientVersion](https://ethereum.org/en/developers/docs/apis/json-rpc/#web3_clientversion)                                           | `relay/<semanticVersion>`                                                                            | Relay Only                                                         |

### Live events API

Details for the Real-Time Events API can be found [here](./live-events-api.md)

### Open RPC Spec

The detailed schema specifications of the current methods offerred by the JSON RPC relay is captured in our
[Open RPC Specification](https://playground.open-rpc.org/?schemaUrl=https://raw.githubusercontent.com/hiero-ledger/hiero-json-rpc-relay/main/docs/openrpc.json&uiSchema%5BappBar%5D%5Bui:splitView%5D=false&uiSchema%5BappBar%5D%5Bui:input%5D=false&uiSchema%5BappBar%5D%5Bui:examplesDropdown%5D=false)
