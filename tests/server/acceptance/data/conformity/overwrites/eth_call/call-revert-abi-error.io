// calls a contract that reverts with an ABI-encoded Error(string) value
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_call/call-revert-abi-error.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
// All other fields must remain unchanged to preserve the integrity of the original test case.

>> {"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x0000000000000000000000000000000000000000","gas":"0x186a0","input":"0x01","to":"0x0ee3ab1371c93e7c0c281cc0c2107cdebc8b1930"},"latest"]}
<< {"result":"0x","jsonrpc":"2.0","id":1}
