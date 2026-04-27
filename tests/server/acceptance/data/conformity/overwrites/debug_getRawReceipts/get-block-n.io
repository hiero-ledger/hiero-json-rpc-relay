// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/debug_getRawReceipts/get-block-n.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result

>> {"jsonrpc":"2.0","id":1,"method":"debug_getRawReceipts","params":["0x3"]}
<< {"jsonrpc":"2.0","id":1,"result":["0x01","0x02","0x03"]}