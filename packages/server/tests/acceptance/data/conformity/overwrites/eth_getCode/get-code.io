// requests code of an existing contract
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getCode/get-code.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

>> {"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df","latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x"}
