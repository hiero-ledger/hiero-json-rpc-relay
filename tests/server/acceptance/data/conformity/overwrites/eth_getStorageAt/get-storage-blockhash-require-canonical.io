// gets storage of a contract with an EIP-1898 {"blockHash", "requireCanonical"} block object
// Reason for override: EIP-1898 block objects are not covered by the execution-apis test suite
// https://eips.ethereum.org/EIPS/eip-1898
//
// The response must match the one for the equivalent string block parameter.
// The block hash is replaced at runtime with the hash of a block that exists on the test network.

>> {"jsonrpc":"2.0","id":1,"method":"eth_getStorageAt","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df","0x0000000000000000000000000000000000000000000000000000000000000000",{"blockHash":"0x2a6275cf6c145fef2429949e11f0db11f677c456e3f595c92d9b44d51196d50a","requireCanonical":true}]}
<< {"jsonrpc":"2.0","id":1,"result":"0x0000000000000000000000000000000000000000000000000000000000000000"}
