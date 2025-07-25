// estimates a simple transfer
// Reason for override:
// The expected result has been overwritten to match the behavior of the current Hedera implementation.

>> {"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"0xaa00000000000000000000000000000000000000","to":"0x0100000000000000000000000000000000000000"}]}
<< {"jsonrpc":"2.0","id":1,"result":"0x592c"}
