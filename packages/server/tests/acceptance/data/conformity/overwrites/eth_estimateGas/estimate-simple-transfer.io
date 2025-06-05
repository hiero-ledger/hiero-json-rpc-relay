// estimates a simple transfer
//
// Reason for override: Estimating gas for sending a transaction to a nonexistent account isn't supported
// in Hedera yet and results in an error. This test case demonstrates that behavior.
>> {"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"0xaa00000000000000000000000000000000000000","to":"0x0100000000000000000000000000000000000000"}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"[Request ID: deb1fb9e-d154-41e9-90e9-dd05973e1000] Invalid parameter 0: Invalid 'value' field in transaction param. Value must be greater than or equal to 0"}}
