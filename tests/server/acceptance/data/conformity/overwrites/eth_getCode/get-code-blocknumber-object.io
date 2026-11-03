// requests code of an existing contract with an EIP-1898 {"blockNumber"} block object
// Reason for override: EIP-1898 block objects are not covered by the execution-apis test suite
// https://eips.ethereum.org/EIPS/eip-1898
//
// The response must match the one for the equivalent string block parameter.

>> {"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df",{"blockNumber":"latest"}]}
<< {"jsonrpc":"2.0","id":1,"result":"0x"}
