// gets a legacy transaction with input data
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionByHash/get-legacy-input.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blockHash, result.blockNumber, result.contractAddress, result.root, result.transactionHash, result.transactionIndex

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0xbdb37c763e721bf1a0e94e0bc72db704110b2ccc6720713708744422a2cc95d6"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0xad351bb438d86efe4a763a75c35c6e26c3b3736a6f33f870a17749b5dfc9da09","blockNumber":"0x71","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gas":"0x30d40","gasPrice":"0x2c68af0bb14000","hash":"0x6974475d6d6c72cedf6b0df7ebab2afefd495291f1ee5839a083f5ec3bf9ad58","input":"0x6080604052348015600f57600080fd5b50609e8061001e6000396000f3fe608060405260043610602a5760003560e01c80635c36b18614603557806383197ef014605557600080fd5b36603057005b600080fd5b348015604057600080fd5b50600160405190815260200160405180910390f35b348015606057600080fd5b50606633ff5b00fea2646970667358221220886a6d6d6c88bcfc0063129ca2391a3d98aee75ad7fe3e870ec6679215456a3964736f6c63430008090033","nonce":"0x4","to":"0x6092b61cbb93803cb92250422a90314982430652","transactionIndex":"0x0","value":"0x0","type":"0x0","chainId":"0x12a","v":"0x277","r":"0x617a994b794b634a59c000341b656be0fce142647de35c64d719b9a06b92506a","s":"0x5033c9fe6227db7545e5bdc7133e36df4b49171b9c00cd3cc4e6f984c850d3e1"}}
