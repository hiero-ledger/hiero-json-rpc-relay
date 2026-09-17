// gets a synthetic transaction by block number and index
//
// Synthetic transactions represent native HAPI operations (here an HTS token transfer) that never
// existed as Ethereum transactions, so every field below is manufactured rather than signed.
//
// The block number and the index are substituted at runtime with the block that actually holds the
// synthetic transaction, since neither is known until the test network has run.
//
// This route builds the transaction from the mirror node's contract result, not from the log, so
// gas, input, r and s differ from what eth_getTransactionByHash returns for the same hash.

## wildcard: result.blockHash, result.blockNumber, result.transactionIndex, result.hash, result.from, result.to, result.chainId, result.gasPrice

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByBlockNumberAndIndex","params":["0x1","0x0"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x0000000000000000000000000000000000000000000000000000000000000000","blockNumber":"0x1","chainId":"0x12a","from":"0x0000000000000000000000000000000000000000","gas":"0x0","gasPrice":"0x0","hash":"0x0000000000000000000000000000000000000000000000000000000000000000","input":"0x","nonce":"0x0","r":"0x0","s":"0x0","to":"0x0000000000000000000000000000000000000000","transactionIndex":"0x0","type":"0x0","v":"0x0","value":"0x0"}}
