// gets tx rlp by hash
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/debug_getRawTransaction/get-tx.io

>> {"jsonrpc":"2.0","id":1,"method":"debug_getRawTransaction","params":["0xbdb37c763e721bf1a0e94e0bc72db704110b2ccc6720713708744422a2cc95d6"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x"}
