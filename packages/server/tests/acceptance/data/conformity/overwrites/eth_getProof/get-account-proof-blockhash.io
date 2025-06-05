// gets proof for a certain account at the specified blockhash
//
// Reason for override: Method eth_getProof is not supported in the hedera json rpc api.
>> {"jsonrpc":"2.0","id":1,"method":"eth_getProof","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df",[],"0x8f64c4436f7213cfdf02cfb9f45d012f1774dfb329b8803de5e7479b11586902"]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"[Request ID: 2e110bdd-1f64-474c-92f0-638782a523d0] Unsupported JSON-RPC method"}}
