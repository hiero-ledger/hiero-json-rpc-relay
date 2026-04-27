// retrieves the an account balance
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBalance/get-balance.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df","latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x21e19e0c9bab2400000"}
