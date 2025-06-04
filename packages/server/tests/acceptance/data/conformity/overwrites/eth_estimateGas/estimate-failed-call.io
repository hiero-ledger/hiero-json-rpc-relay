// estimates a contract call that reverts
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_estimateGas/estimage-failed-call.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
// All other fields must remain unchanged to preserve the integrity of the original test case.
>> {"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"0x0102030000000000000000000000000000000000","input":"0xff030405","to":"0x17e7eedce4ac02ef114a7ed9fe6e2f33feba1667"}]}
<< {"result":"0x","jsonrpc":"2.0","id":1}
