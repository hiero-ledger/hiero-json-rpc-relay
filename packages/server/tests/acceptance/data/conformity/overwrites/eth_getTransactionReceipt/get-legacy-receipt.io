// gets the receipt for a legacy value transfer tx
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionReceipt/get-legacy-receipt.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.root, result.transactionIndex

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xeb51add00179bc30b868d0cc81509fd46fbfd9c11bdbac5714b8750be9248a18"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0xa4c56cd054b9f8a4db0e22beed53f3a90f3b5740ed8bb8e297bb3f3eb78deee7","blockNumber":"0x35","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","cumulativeGasUsed":"0x30d40","gasUsed":"0x30d40","contractAddress":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","logs":[],"logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","transactionHash":"0xce8bfc3ea57c50a185e2fe61fc8d680a16b5a18dad9d6f05afdbdeb3c3a4516e","transactionIndex":"0x5","effectiveGasPrice":"0xa54f4c3c00","root":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","status":"0x1","type":"0x0"}}
