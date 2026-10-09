// estimates a contract call that reverts using Solidity Error(string) data
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp, and a sender
// account that only exists on that chain.
//
// The same contract (identical runtime code) is deployed by the third entry of `genesis.json` during the
// conformity setup. The `params[0].to` field points to that contract's address, and `params[0].from` to
// `sendAccountAddress`, which exists on our test node. All other fields, and the expected response, are unchanged.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_estimateGas/estimate-call-abi-error.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"0xc37f417fa09933335240fca72dd257bfbde9c275","input":"0x01","to":"0xddfe287e55670b8bfb80d1f2d40c18d924fa0e31"}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted: user error","data":"0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000a75736572206572726f72"}}
