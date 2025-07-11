// gets block 1
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBlockByHash/get-block-by-hash.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.blobGasUsed, result.excessBlobGas, result.parentBeaconBlockRoot, result.timestamp, result.baseFeePerGas, result.hash, result.receiptsRoot, result.number, result.size, result.transactions, result.transactionsRoot, result.parentHash

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBlockByHash","params":["0x3fd02fdde668a942d52d983eec94e5a8cfa8ee3e248f54176f6c77432f980e3b",true]}
<< {"jsonrpc":"2.0","id":1,"result":{"timestamp":"0x686b9289","difficulty":"0x0","extraData":"0x","gasLimit":"0x1c9c380","baseFeePerGas":"0xa54f4c3c00","gasUsed":"0x30d40","logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","miner":"0x0000000000000000000000000000000000000000","mixHash":"0x0000000000000000000000000000000000000000000000000000000000000000","nonce":"0x0000000000000000","receiptsRoot":"0x3dc757450f5bcbca25a602c290f071b46671fe8428bd26f6ec3b276e6072e9bd","sha3Uncles":"0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347","size":"0x92f","stateRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","totalDifficulty":"0x0","transactions":[{"blockHash":"0x555c73eaeb6db30377fcc3bd0eb0bce32b6ea2f5cddd70928cf4f1e573aa79d9","blockNumber":"0x6c","chainId":"0x12a","from":"0xc37f417fa09933335240fca72dd257bfbde9c275","gas":"0x30d40","gasPrice":"0x2c68af0bb14000","hash":"0xae79281488265143ccde1d153bbaac3891d02fec1b7253dcd9bc2396d0168417","input":"0x","nonce":"0x1","r":"0x273ba8165ec42f17763fcb799ee5feabf5520ef8611b43f0480c027bb010327a","s":"0x404c040241f2746e8c3747f7c3b8ecea21e8b73d24e50bfc1cf25c3954592e90","to":"0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69","transactionIndex":"0x7","type":"0x1","v":"0x1","value":"0x2e90edd000","yParity":"0x1","accessList":[]}],"transactionsRoot":"0x555c73eaeb6db30377fcc3bd0eb0bce32b6ea2f5cddd70928cf4f1e573aa79d9","uncles":[],"withdrawals":[],"withdrawalsRoot":"0x0000000000000000000000000000000000000000000000000000000000000000","number":"0x6c","hash":"0x555c73eaeb6db30377fcc3bd0eb0bce32b6ea2f5cddd70928cf4f1e573aa79d9","parentHash":"0x87c44c66d241126d121a0796e4a75039df47f0daad2a967d038bbc82e993f368"}}
