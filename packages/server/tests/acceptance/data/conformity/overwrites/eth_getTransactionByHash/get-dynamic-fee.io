// gets a dynamic fee transaction
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionByHash/get-dynamic-fee.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.transactionIndex

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0x847f7a3261988dc4a34be85f4c28d5d534d47775792e9d25e1d9250cb2fb77eb"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0xf3488b008a901089c36a4c8f8e14727da61453e139fb8ef7389f199552e09716","blockNumber":"0x75","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gas":"0x30d40","gasPrice":"0x0","maxFeePerGas":"0x1312d0","maxPriorityFeePerGas":"0x1312d0","hash":"0xc1c8f23c76930f81a075b55c85a5ee2da8177644da46cbdc3424ded08a9ef93c","input":"0x","nonce":"0x2","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","transactionIndex":"0x4","value":"0x2e90edd000","type":"0x2","accessList":[],"chainId":"0x12a","v":"0x0","r":"0x80f53012410d59b1b38f2c58e48cdd98edf4b6d9d1195897f9a0bbbbcb23f914","s":"0x66aa7309cce8594daebf6a057a20d84cabb4e9fd1049bfa03c9eeb5316991a8d","yParity":"0x0"}}
