// gets a legacy contract create transaction
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionReceipt/get-legacy-contract.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.root, result.transactionIndex, result.transactionHash, result.contractAddress

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xce8bfc3ea57c50a185e2fe61fc8d680a16b5a18dad9d6f05afdbdeb3c3a4516e"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x19dc1abfed793e98a962aee8763ffbefdcc789ee0cd5657679eccae933a2807e","blockNumber":"0x45","contractAddress":"0xca10dc92a0cd60b804a825342340f24137b85988","cumulativeGasUsed":"0x30d40","effectiveGasPrice":"0xa54f4c3c00","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gasUsed":"0x30d40","logs":[],"logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","status":"0x1","to":null,"transactionHash":"0x8a3a7255dbccd79bb3ef12fa9238d35b6449e1fe1f2bc82b195eaaf162f2517f","transactionIndex":"0x2","type":"0x0"}}
