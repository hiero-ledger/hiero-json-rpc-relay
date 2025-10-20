// estimates a simple transfer
// Reason for override:
// The expected result has been overwritten to match the behavior of the current Hedera implementation.
// addresses used in the request below are auto-created accounts from hedera-local network

>> {"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","to":"0x05fba803be258049a27b820088bab1cad2058871"}]}
<< {"jsonrpc":"2.0","id":1,"result":"0x592c"}
