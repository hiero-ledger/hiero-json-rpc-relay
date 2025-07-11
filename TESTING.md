# Hedera JSON-RPC Conformity Tests

This document provides an overview of the conformity tests used to validate the Hedera JSON-RPC relay against the [Ethereum Execution API JSON-RPC specification](https://github.com/ethereum/execution-apis).

## Purpose

The conformity tests ensure that the Hedera JSON-RPC relay correctly implements the Ethereum JSON-RPC API specification. These tests validate that:

1. The relay correctly handles JSON-RPC requests according to the Ethereum specification
2. The responses match the expected format and content
3. Error handling follows the JSON-RPC 2.0 specification
4. The relay behaves correctly for both supported and unsupported methods

## Test Structure

The conformity tests are organized into 5 batches, each focusing on different aspects of the JSON-RPC API:

### Batch 1: Core Ethereum Execution API Tests

This batch tests the core Ethereum JSON-RPC methods by:
- Reading test cases from the Ethereum execution-apis repository
- Using custom overrides for Hedera-specific behavior
- Validating responses against the OpenRPC schema

The tests in this batch cover methods like:
- eth_getBlockByHash
- eth_getBlockByNumber
- eth_getTransactionByHash
- eth_getTransactionReceipt
- eth_sendRawTransaction
- eth_getBalance
- And many others

### Batch 2: Filter and Subscription Methods

This batch focuses on filter-related methods:
- eth_newBlockFilter
- eth_newFilter
- eth_getFilterChanges
- eth_getFilterLogs
- eth_uninstallFilter

It also tests methods that are expected to return errors, such as:
- eth_submitHashrate
- eth_sign
- eth_signTransaction
- eth_sendTransaction
- eth_protocolVersion
- eth_coinbase
- eth_blobBaseFee
- eth_getWork
- eth_newPendingTransactionFilter

### Batch 3: Debug, Trace, and WebSocket Methods

This batch is divided into two sections:

1. Server methods:
   - eth_submitWork
   - debug_traceBlockByNumber
   - debug_traceTransaction
   - net_listening
   - net_version
   - web3_clientVersion
   - web3_sha3

2. WebSocket methods:
   - eth_newFilter
   - eth_subscribe
   - eth_unsubscribe

It also tests error handling for unsupported methods like engine_* and trace_*.

### Batch 4: Contract Interaction Methods

This batch focuses on methods used for interacting with smart contracts:

1. eth_call - Tests various scenarios:
   - Non-existing contracts
   - Existing contracts with view functions
   - Transactions with existing and non-existing "from" addresses
   - Transactions with positive values

2. eth_estimateGas - Tests similar scenarios as eth_call

3. eth_getLogs - Tests:
   - Non-existing contracts
   - Existing contracts
   - Existing contracts with from/to block parameters

### Batch 5: Utility and Mining Methods

This batch tests various utility methods and methods related to Ethereum's mining mechanism:
- eth_accounts
- eth_gasPrice
- eth_getUncleByBlockHashAndIndex
- eth_getUncleByBlockNumberAndIndex
- eth_getUncleCountByBlockHash
- eth_getUncleCountByBlockNumber
- eth_hashrate
- eth_maxPriorityFeePerGas
- eth_mining

## Test Overrides

Due to protocol differences between Ethereum and Hedera, some test cases from the Ethereum Execution API test suite cannot be executed as-is against a Hedera node. The project includes Hedera-compatible test overrides that:

- Mirror the structure of the upstream tests
- Reflect behavior specific to the Hedera JSON-RPC relay
- Serve as a drop-in replacement when upstream tests are not applicable

### Override Structure

Each test override is stored using the `.io` format:

```
Overrides
   eth_call/
      call-callenv.io
   eth_getLogs/
      no-topics.io
```

Each file consists of a single round-trip request and response:

```
>> {"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}
<< {"jsonrpc":"2.0","id":1,"result":"0x3"}
```

### When to Create an Override

You should create an override when:

* A test in the upstream suite fails or must be modified due to Hedera-specific limitations (e.g., unsupported chain id)
* You want to define a custom behavior or scenario that applies specifically to Hedera's implementation
* You need to test features not currently supported in the standard Ethereum Execution APIs

## Test Execution

The conformity tests are executed as part of the acceptance test suite. They:

1. Set up the necessary test environment (accounts, contracts, etc.)
2. Execute the test cases against the Hedera JSON-RPC relay
3. Validate the responses against the expected results
4. Check for schema compliance using the OpenRPC specification

## Documentation and References

* [Ethereum Execution APIs test suite](https://github.com/ethereum/execution-apis/tree/main/tests)
* [Hive rpc-compat simulator](https://github.com/ethereum/hive/tree/master/simulators/ethereum/rpc-compat)
* [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
