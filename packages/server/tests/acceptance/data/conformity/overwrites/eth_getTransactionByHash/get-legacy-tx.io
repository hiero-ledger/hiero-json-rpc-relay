// gets a legacy transaction
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionByHash/get-legacy-tx.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.contractAddress, result.root, result.transactionHash, result.transactionIndex

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0x3f38cdc805c02e152bfed34471a3a13a786fed436b3aec0c3eca35d23e2cdd2c"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x51715fd9cfe39f121b90971fe0c1ee94e5d68732dafd1f2e9a93abb952104b98","blockNumber":"0x63","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gas":"0x30d40","gasPrice":"0x2c68af0bb14000","hash":"0xce8bfc3ea57c50a185e2fe61fc8d680a16b5a18dad9d6f05afdbdeb3c3a4516e","input":"0x","nonce":"0x0","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","transactionIndex":"0x9","value":"0x2e90edd000","type":"0x0","chainId":"0x12a","v":"0x278","r":"0xa685541e887688a4e3f0dbd00e58313f3a466fc0f012bfd4845497b4b16b575e","s":"0x7b300e3c6b327a9c878f1d4476587f8ed8f5303853500b6594f096c945602"}}

