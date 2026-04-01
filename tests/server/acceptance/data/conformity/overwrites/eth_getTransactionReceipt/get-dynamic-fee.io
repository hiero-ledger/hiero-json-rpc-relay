// gets a dynamic fee transaction
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionReceipt/get-dynamic-fee.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.root, result.transactionIndex

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x3fd02fdde668a942d52d983eec94e5a8cfa8ee3e248f54176f6c77432f980e3b"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x1baa3b44815e0f6ebecc55150a142709e6ba8fcf033170708673c39fe262695a","blockNumber":"0x42","contractAddress":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","cumulativeGasUsed":"0x30d40","effectiveGasPrice":"0xa54f4c3c00","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gasUsed":"0x30d40","logs":[],"logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","status":"0x1","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","transactionHash":"0xc1c8f23c76930f81a075b55c85a5ee2da8177644da46cbdc3424ded08a9ef93c","transactionIndex":"0x5","type":"0x2"}}
