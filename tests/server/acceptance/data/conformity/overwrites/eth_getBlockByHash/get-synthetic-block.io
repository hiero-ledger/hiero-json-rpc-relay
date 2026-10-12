// gets a block holding a synthetic transaction, by hash
//
// Synthetic transactions represent native HAPI operations (here an HTS token transfer) that never
// existed as Ethereum transactions. A block is the third place the relay renders one, built by yet
// another code path than eth_getTransactionByHash and the by-index lookups.
//
// The block hash is substituted at runtime with the block that actually holds the synthetic
// transaction. Only the transaction list is recorded here; the block's own fields are covered by
// get-block-by-hash.io, and fields left out of the entry below are not compared.
//
// A Hedera block is a slice of time rather than a chosen set of transactions, so its contents cannot
// be pinned exactly. The recorded entry is matched by containment: the block must hold a transaction
// that used no gas, carried no calldata and bears no signature.

## contains: result.transactions

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBlockByHash","params":["0x0000000000000000000000000000000000000000000000000000000000000000",true]}
<< {"jsonrpc":"2.0","id":1,"result":{"transactions":[{"gas":"0x0","input":"0x","r":"0x0","s":"0x0","type":"0x0","value":"0x0"}]}}
