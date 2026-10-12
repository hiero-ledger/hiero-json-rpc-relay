// gets nonce for a known account with an EIP-1898 {"blockHash", "requireCanonical"} block object
// Reason for override: EIP-1898 block objects are not covered by the execution-apis test suite
// https://eips.ethereum.org/EIPS/eip-1898
//
// The response must match the one for the equivalent string block parameter.
// The block hash is replaced at runtime with the hash of a block that exists on the test network.
//
// The `result` field is included in `wildcard` because it depends on the current state of the network.

## wildcard: result

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["0xc37f417fA09933335240FCA72DD257BFBdE9C275",{"blockHash":"0x2a6275cf6c145fef2429949e11f0db11f677c456e3f595c92d9b44d51196d50a","requireCanonical":true}]}
<< {"jsonrpc":"2.0","id":1,"result":"0x7"}
