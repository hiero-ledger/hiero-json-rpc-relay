// gets nonce for a known account
//
// Reason for override: This test originally uses an address corresponding to a predeployed account included
// in the chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a modified version of the test
// that queries the transaction count for an address (`sendAccountAddress`) that exists on our test node.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionCount/get-nonce.io
// Only the `params[0]` field and the `result` field have been changed:
// - `params[0]` now points to `sendAccountAddress`
// - `result` is set to the value returned by `conformityTest` for that address
// All other fields must remain unchanged to preserve the integrity of the original test case.

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["0xc37f417fA09933335240FCA72DD257BFBdE9C275","latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x7"}