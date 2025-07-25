// Creates an access list for a contract invocation that accesses storage.
// This invocation uses EIP-1559 fields to specify the gas price.
// Method not implemented in hedera json rpc api

>> {"jsonrpc":"2.0","id":1,"method":"eth_createAccessList","params":[{"from":"0x0c2c51a0990aee1d73c1228de158688341557508","gas":"0xea60","input":"0x010203040506","maxFeePerGas":"0x5763d64","maxPriorityFeePerGas":"0x3","nonce":"0x0","to":"0x7dcd17433742f4c0ca53122ab541d0ba67fc27df"},"latest"]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"[Request ID: 2e110bdd-1f64-474c-92f0-638782a523d0] Unsupported JSON-RPC method"}}
