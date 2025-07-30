// gets an access list transaction
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionByHash/get-access-list.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.transactionIndex

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0xa0762610d794acddd2dca15fb7c437ada3611c886f3bea675d53d8da8a6c41b2"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x7822bab5f72f55f0d80152c2be40e8a2676269b1e45f34f1cbd185dfea8fa5c0","blockNumber":"0x65","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gas":"0x30d40","gasPrice":"0x2c68af0bb14000","hash":"0xae79281488265143ccde1d153bbaac3891d02fec1b7253dcd9bc2396d0168417","input":"0x","nonce":"0x1","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","transactionIndex":"0x7","value":"0x2e90edd000","type":"0x1","accessList":[],"chainId":"0x12a","v":"0x1","r":"0x273ba8165ec42f17763fcb799ee5feabf5520ef8611b43f0480c027bb010327a","s":"0x404c040241f2746e8c3747f7c3b8ecea21e8b73d24e50bfc1cf25c3954592e90","yParity":"0x1"}}
