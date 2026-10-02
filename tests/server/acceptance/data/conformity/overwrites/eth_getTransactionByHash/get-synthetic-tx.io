// gets a synthetic transaction by hash
//
// Synthetic transactions represent native HAPI operations (here an HTS token transfer) that never
// existed as Ethereum transactions. The relay synthesizes them from mirror node logs, so every
// field below is manufactured rather than signed.

## wildcard: result.blockHash, result.blockNumber, result.transactionIndex, result.hash, result.from, result.to

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":["0x0000000000000000000000000000000000000000000000000000000000000000"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x0000000000000000000000000000000000000000000000000000000000000000","blockNumber":"0x1","chainId":"0x12a","from":"0x0000000000000000000000000000000000000000","gas":"0x61a80","gasPrice":"0xfe","hash":"0x0000000000000000000000000000000000000000000000000000000000000000","input":"0x0000000000000000","nonce":"0x0","r":"0x","s":"0x","to":"0x0000000000000000000000000000000000000000","transactionIndex":"0x0","type":"0x0","v":"0x0","value":"0x0"}}
