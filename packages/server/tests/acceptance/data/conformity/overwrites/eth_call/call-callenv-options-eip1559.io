// Performs a call to the callenv contract, which echoes the EVM transaction environment.
// This call uses EIP1559 transaction options.
// See https://github.com/ethereum/hive/tree/master/cmd/hivechain/contracts/callenv.eas for the output structure.
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_call/call-callenv-options-eip1559.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
// All other fields must remain unchanged to preserve the integrity of the original test case.
>> {"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x14e46043e63d0e3cdcf2530519f4cfaf35058cb2","gas":"0xea60","input":"0x333435","maxFeePerGas":"0x44103f3","maxPriorityFeePerGas":"0xb","to":"0x9344b07175800259691961298ca11c824e65032d","value":"0x17"},"latest"]}
<< {"result":"0x","jsonrpc":"2.0","id":1}
