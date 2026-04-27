// requests the balance of a non-existent account
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBalance/get-balance-unknown-account.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xc1cadaffffffffffffffffffffffffffffffffff","latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x0"}
