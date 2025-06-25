// gets storage of a contract
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getStorageAt/get-storage.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
//
// All other fields in the request body must remain unchanged to preserve the integrity of the original test case.
//
// The smart contract must be deployed at the address: 0x2f2a392b4d7d2c2d3134e199295818a02535ef0a
// It should store the value 0x000000000000000000000000000000000000000000000000000000000000001c at memory slot 0
>> {"jsonrpc":"2.0","id":1,"method":"eth_getStorageAt","params":["0x2f2a392b4d7d2c2d3134e199295818a02535ef0a","0x0000000000000000000000000000000000000000000000000000000000000000","latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x000000000000000000000000000000000000000000000000000000000000001c"}
