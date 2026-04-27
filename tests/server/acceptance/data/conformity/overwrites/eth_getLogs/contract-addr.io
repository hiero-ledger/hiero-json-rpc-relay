// queries for logs from a specific contract across a range of blocks
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

>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df"],"fromBlock":"0x1","toBlock":"0x4","topics":null}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"[Request ID: 312e9b88-53a1-433a-8f32-28e3acf1ba46] Invalid parameter 'topics' for FilterObject: Expected an array or array of arrays containing Expected 0x prefixed string representing the hash (32 bytes) of a topic, value: null"}}
