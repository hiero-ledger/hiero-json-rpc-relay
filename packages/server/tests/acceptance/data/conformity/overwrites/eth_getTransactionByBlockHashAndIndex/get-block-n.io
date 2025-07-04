// gets tx 0 in a non-empty block
// Reason for override: The transaction is generated during test execution and the entire response is replaced
//
// The following fields are treated as wildcards — only their presence is validated, not their values
// All other fields must match exactly.

## wildcard: result.blockHash, result.blockNumber, result.transactionIndex, result.hash, result.nonce, result.r, result.s, result.v

>> {"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByBlockHashAndIndex","params":["0xbb198addc8a129024ed75dbe52a8c89a6baa97980c855241790439db182a210b","0x0"]}
<< {"jsonrpc":"2.0","id":1,"result":{"blockHash":"0x542b67a7e4bc32e8e047aa6d71b2a94928727e118214df47d06fda59e1750309","blockNumber":"0x7fc","chainId":"0x12a","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gas":"0x30d40","gasPrice":"0x2c68af0bb14000","hash":"0x3b933c75acd2cd0d0719070ff29981bd290ed2c5f9bae34a0b6239e414725af4","input":"0x","nonce":"0x15","r":"0x7fbd2b7b38a78038a7e29619ac30037356e8c1ac68d5ff398017c3d139e9899a","s":"0x3fe4f050ca5c8d5c8026e0afb1001408009ebb0da88b2f79653218795ec603a8","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","transactionIndex":"0x4","type":"0x0","v":"0x277","value":"0x2e90edd000"}}
