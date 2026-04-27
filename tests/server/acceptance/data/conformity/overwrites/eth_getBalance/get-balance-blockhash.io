// retrieves the an account's balance at a specific blockhash
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBalance/get-balance-blockhash.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df","0x2a6275cf6c145fef2429949e11f0db11f677c456e3f595c92d9b44d51196d50a"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x21e19e0c9bab2400000"}
