// gets tx count in a non-empty block
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBlockTransactionCountByNumber/get-block-n.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBlockTransactionCountByNumber","params":["0x1"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x2"}
