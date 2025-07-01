# Hedera JSON-RPC test overrides

This directory contains **overridden test cases** for the [Ethereum Execution API JSON-RPC test suite](https://github.com/ethereum/execution-apis/tree/main/tests), adjusted to validate **Hedera’s JSON-RPC relay**.

## Purpose

The upstream `rpc-compat` test suite is designed for Ethereum clients and assumes compatibility with Ethereum-specific data (e.g., signed blocks in `chain.rlp`, Ethereum chain IDs, transaction signatures). However, due to protocol differences, **some test cases cannot be executed as-is against a Hedera node**.

This directory provides **Hedera-compatible test overrides** that:

- Mirror the structure of the upstream tests.
- Reflect behavior specific to the Hedera JSON-RPC relay.
- Serve as a drop-in replacement when upstream tests are not applicable.

## Structure

Each test override is stored using the `.io` format:

```
Overrides
   eth_call/
      call-callenv.io
   eth_getLogs/
      no-topics.io
````

Each file consists of a single round-trip request and response:

```
>> {"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}
<< {"jsonrpc":"2.0","id":1,"result":"0x3"}
````

The folder structure mirrors the upstream suite (`tests/{method}/{test-name}.io`), making it easy to identify which test is being overridden.

## When to create an override

You should create an override when:

* A test in the upstream suite fails or must be skipped due to Hedera-specific limitations (e.g., unsupported chain id, which prevents us from replaying pre-signed transactions from chain.rlp. This is especially problematic when the test depends on a smart contract being deployed to a specific address; something we cannot replicate because we can't recreate those transactions without re-signing them using the original, unsupported chain id).
* You want to define a **custom behavior** or scenario that applies specifically to Hedera's implementation.
* You need to **test features not currently supported in the standard Ethereum Execution APIs**, such as Hedera-specific endpoints or modified responses.

## How to create a new override

1. **Identify the test** that cannot be executed or validated as-is.

2. **Create a new `.io` file** under `tests-overrides/{method}/{test-name}.io`.

3. Use the following format:

   ```
   >> { JSON-RPC request }
   << { Expected JSON-RPC response }
   ```

4. Make sure the test reflects realistic Hedera state. You can:

    * Preset required accounts and balances on your local node.
    * Deploy required contracts manually if the original test assumes them.
    * Emulate necessary conditions to simulate the expected behavior.

5. If applicable, **add a comment (inside the file or a companion note)** explaining why the override exists and how it differs from the upstream test.

## Test format rules

* Tests **must be single round-trip** (request → response).
* Subscription methods are **not currently supported**.
* Follow JSON-RPC 2.0 format strictly.
* Avoid relying on chain.rlp or genesis.json files. Instead, manually recreate (or "shadow") the required transactions and state setup before running the tests.

## Documentation and references

* [Ethereum Execution APIs test suite](https://github.com/ethereum/execution-apis/tree/main/tests)
* [Hive rpc-compat simulator](https://github.com/ethereum/hive/tree/master/simulators/ethereum/rpc-compat)
* [Hedera JSON-RPC Relay (internal documentation)](https://your-internal-docs-link-if-applicable)
