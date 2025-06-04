// estimates a simple transfer
//
// Reason for override: TODO
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_estimateGas/estimage-failed-call.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
// All other fields must remain unchanged to preserve the integrity of the original test case.
>> {"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"0xaa00000000000000000000000000000000000000","to":"0x0100000000000000000000000000000000000000"}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"[Request ID: deb1fb9e-d154-41e9-90e9-dd05973e1000] Invalid parameter 0: Invalid 'value' field in transaction param. Value must be greater than or equal to 0"}}
