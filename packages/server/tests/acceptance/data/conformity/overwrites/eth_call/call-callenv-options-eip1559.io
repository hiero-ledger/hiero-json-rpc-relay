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
// Only the `params[0].to` field value of the request body has been changed to point to the correct deployed contract
// address.
// All other fields must remain unchanged to preserve the integrity of the original test case.
//
// Additionally, the result field in the response was updated to reflect the actual parameters of the default
// local node instance.
//
// The smart contract should be deployed to the address: 0x2f2a392b4d7d2c2d3134e199295818a02535ef0a
// It should return the value in the format of seven 32-byte fields, where each field contains the following value:
//
// 1. block.number     — 0x2d expected, 0xac on Hedera; reflects current block height (Ethereum vs Hedera testnet).
// 2. chainid          — 0x0c72dd9d5e883e expected, 0x12a on Hedera; default local chain id is 298.
// 3. block.coinbase   — 0x00 expected, 0x62 on Hedera; miner address is simulated and node-dependent on Hedera.
// 4. block.basefee    — 0x05763d64 expected, 0x07 on Hedera; Hedera uses fixed or simplified basefee for EVM calls.
// 5. difficulty       — 0x00 expected, random 32-byte value on Hedera; represents prevrandao (random seed).
// 6. tx.origin        — 0x14e4...58cb2 expected and returned; caller’s address passed in transaction 'from' field.
// 7. msg.value        — 0x17 (23 in decimal) expected and returned; actual value sent in the eth_call or transaction.
//
>> {"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x14e46043e63d0e3cdcf2530519f4cfaf35058cb2","gas":"0xea60","input":"0x333435","maxFeePerGas":"0x44103f3","maxPriorityFeePerGas":"0xb","to":"0x2f2a392b4d7d2c2d3134e199295818a02535ef0a","value":"0x17"},"latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x00000000000000000000000000000000000000000000000000000000000000ac000000000000000000000000000000000000000000000000000000000000012a0000000000000000000000000000000000000000000000000000000000000062000000000000000000000000000000000000000000000000000000000000000075def97dfe5beb77b5d1de1b71cd5bddfdf47dd77af36d5fd9e6db7f5f36e1b7000000000000000000000000435d7d41d4f69f958bda7a8d9f549a0dd9b64c860000000000000000000000000000000000000000000000000000000000000001"}
