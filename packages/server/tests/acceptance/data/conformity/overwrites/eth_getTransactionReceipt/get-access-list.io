// gets an access list transaction
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionReceipt/get-access-list.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.logsBloom, result.transactionIndex, result.type, result.status

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x3fd02fdde668a942d52d983eec94e5a8cfa8ee3e248f54176f6c77432f980e3b"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x82c22563f9b50c19d6d7aeac32a9146f5bc3d27ca2711738e850b960cc493f03","blockNumber":"0x3f","contractAddress":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","cumulativeGasUsed":"0x30d40","effectiveGasPrice":"0xa54f4c3c00","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gasUsed":"0x30d40","logs":[],"logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","root":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","transactionHash":"0xae79281488265143ccde1d153bbaac3891d02fec1b7253dcd9bc2396d0168417","transactionIndex":"0x8"}}
