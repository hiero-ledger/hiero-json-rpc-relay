// calls a contract that reverts with an ABI-encoded Error(string) value
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// The same contract (identical runtime code) is deployed by the third entry of `genesis.json` during the
// conformity setup. Only the `params[0].to` field value has been changed to point to that contract's address.
// All other fields, and the expected response, are unchanged from the original test case.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_call/call-revert-abi-error.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x0000000000000000000000000000000000000000","gas":"0x186a0","input":"0x01","to":"0xddfe287e55670b8bfb80d1f2d40c18d924fa0e31"},"latest"]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted: user error","data":"0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000a75736572206572726f72"}}
