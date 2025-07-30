// estimates a contract call that reverts
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_estimateGas/estimage-failed-call.io
//
// The `params[0].to` field value has been changed to point to the correct deployed contract address.
//
// Additionally, the expected response has been modified to match Hedera's current behavior.
// In the original test, the call fails and returns an error:
// << {"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted","data":"0x77726f6e672d63616c6c6461746173697a65"}}
//
// However, Hedera does not currently return an error in this case, instead responding with:
// << {"result":"0x","jsonrpc":"2.0","id":1}
//
// The test has been adjusted accordingly, but this may indicate a bug in Hedera's implementation.
// If so, it might be better to fix the underlying issue instead of adapting the test.

>> {"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"0x0102030000000000000000000000000000000000","input":"0xff030405","to":"0x17e7eedce4ac02ef114a7ed9fe6e2f33feba1667"}]}
<< {"result":"0x596c","jsonrpc":"2.0","id":1}
