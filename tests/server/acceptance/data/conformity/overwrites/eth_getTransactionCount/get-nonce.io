// gets nonce for a known account
//
// Reason for override: This test originally uses an address corresponding to a predeployed account included
// in the chain.rlp block data: https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a modified version of the test
// that queries the transaction count for an address (`sendAccountAddress`) that exists on our test node.
//
// Note: This is the original test file: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getTransactionCount/get-nonce.io
//
// The `result` field is included in `wildcard` because it depends on the current state of the network,
// and may change if additional transactions are sent from `sendAccountAddress` or if the chain state is modified
// in future test updates. This ensures the test remains valid even if the nonce value changes over time.

## wildcard: result

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["0xc37f417fA09933335240FCA72DD257BFBdE9C275","latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x7"}