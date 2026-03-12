// queries for logs with two topics, with both topics set explictly
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getLogs/topic-exact-match.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
// All other fields must remain unchanged to preserve the integrity of the original test case.
>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":null,"fromBlock":"0x2","toBlock":"0x5","topics":[["0x00000000000000000000000000000000000000000000000000000000656d6974"],["0xb52248fb459b43720abbf1d5218c4ede9036a623653b31c2077991e04da9a456"]]}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"[Request ID: ad8a9b55-e963-4fc5-91f5-f135cbf96822] Invalid parameter 'address' for FilterObject: Expected 0x prefixed string representing the address (20 bytes) or an array of addresses, value: null"}}
