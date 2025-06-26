// requests the account proof for a known account
//
// Reason for override: Method eth_getProof is not supported in the hedera json rpc api.
>> {"jsonrpc":"2.0","id":1,"method":"eth_getProof","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df",[],"latest"]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"[Request ID: 7809f7d9-5153-4b1e-a523-b1aade47f939] Unsupported JSON-RPC method"}}
