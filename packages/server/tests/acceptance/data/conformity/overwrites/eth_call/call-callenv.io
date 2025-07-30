// Performs a call to the callenv contract, which echoes the EVM transaction environment.
// See https://github.com/ethereum/hive/tree/master/cmd/hivechain/contracts/callenv.eas for the output structure.
//
// Reason for override: This test uses a smart contract that was predeployed by a transaction included in the
// chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario. This is done by pointing the `to` address to the contract already deployed on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_call/call-callenv.io
// Only the `params[0].to` field value has been changed to point to the correct deployed contract address.
//
// All other fields in the request body must remain unchanged to preserve the integrity of the original test case.
//
// The smart contract should be deployed to the address: 0x2f2a392b4d7d2c2d3134e199295818a02535ef0a
// It should return the value in the format of seven 32-byte fields, where each field contains the following:
//
// 1. block.number     — 0x14 expected, 0x8c1 on Hedera; block height is higher due to real-time chain state.
// 2. chainid          — 0x0c72dd9d5e883e expected, 0x12a on Hedera; test used a placeholder, Hedera testnet uses chain ID 298.
// 3. block.coinbase   — 0x00 expected, 0x62 on Hedera; coinbase is simulated and not used for rewards on Hedera.
// 4. block.basefee    — 0x00 expected, 0x00 on Hedera; basefee is present but set to zero when not explicitly simulated.
// 5. difficulty       — 0x00 expected, Hedera returned prevrandao value (randomness source in PoS networks).
// 6. tx.origin        — 0x00 expected and returned; tx sent from 0x0, so origin is also zero.
// 7. msg.value        — 0x00 expected and returned; no value was sent with the call, as expected.
//

## wildcard: result

>> {"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x0000000000000000000000000000000000000000","to":"0x2f2a392b4d7d2c2d3134e199295818a02535ef0a"},"latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x00000000000000000000000000000000000000000000000000000000000008c1000000000000000000000000000000000000000000000000000000000000012a00000000000000000000000000000000000000000000000000000000000000620000000000000000000000000000000000000000000000000000000000000000ddef36f5bedc6b4f1ef766fd735d7cd1c7da7f675ddb5d5f7ddd3479cdb4f76d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"}
