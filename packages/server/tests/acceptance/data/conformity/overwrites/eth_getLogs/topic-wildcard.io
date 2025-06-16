// queries for logs with two topics, with both topics set explictly
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getLogs/contract-addr.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
// All other fields must remain unchanged to preserve the integrity of the original test case.
//
// Additionally, it is worth to note that the block numbers, block hash, tx indexes in response will be different than
// in the initial example.
//
// WARNING - Hedera does not allow address to be null! Empty array is required! In the OpenRPC JSON api scehama,
// address field is nullable!
//
// Hedera json rpc does not support null address, so deployed contract address 0xddfe287e55670b8bfb80d1f2d40c18d924fa0e31 sent instead.
>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":"0xddfe287e55670b8bfb80d1f2d40c18d924fa0e31","fromBlock":"0x2","toBlock":"0x279","topics":[[],["0xb52248fb459b43720abbf1d5218c4ede9036a623653b31c2077991e04da9a456"]]}]}
<< {"jsonrpc":"2.0","id":1,"result":[{"address":"0x7dcd17433742f4c0ca53122ab541d0ba67fc27df","topics":["0x00000000000000000000000000000000000000000000000000000000656d6974","0xb52248fb459b43720abbf1d5218c4ede9036a623653b31c2077991e04da9a456"],"data":"0x0000000000000000000000000000000000000000000000000000000000000003","blockNumber":"0x3","transactionHash":"0x8acb279f66e5fa56b6718166c0296dfd4bfaf7be6757d35cbbcc40367f2904ba","transactionIndex":"0x1","blockHash":"0x1732a5fe86d54098c431fa4fea34387b650e41dbff65ca554370028172fcdb6a","logIndex":"0x1","removed":false}]}
