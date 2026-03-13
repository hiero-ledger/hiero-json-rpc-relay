// gets proof for a certain account
//
// Reason for override: Method eth_getProof is not supported in the hedera json rpc api.
>> {"jsonrpc":"2.0","id":1,"method":"eth_getProof","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df",["0x00"],"latest"]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"[Request ID: 71b7174d-7cf2-4bdf-828f-04b77217a765] Unsupported JSON-RPC method"}}
