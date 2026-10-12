// gets the receipts of a block holding a synthetic transaction
//
// Synthetic transactions represent native HAPI operations (here an HTS token transfer) that never
// existed as Ethereum transactions, so the relay manufactures a receipt for them. The telltale of
// such a receipt is that no gas was used: the transaction never reached the EVM.
//
// The block number is substituted at runtime with the block that actually holds the synthetic
// transaction, since it is not known until the test network has run.
//
// A Hedera block is a slice of time rather than a chosen set of transactions, so its receipts cannot
// be pinned exactly. The recorded entry below is matched by containment: the block must hold a
// receipt shaped like this one, and anything else in the block is ignored.

## contains: result

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["0x1"]}
<< {"jsonrpc":"2.0","id":1,"result":[{"cumulativeGasUsed":"0x0","gasUsed":"0x0","status":"0x1","type":"0x0"}]}
