// gets block 0
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBlockByNumber/get-genesis.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.baseFeePerGas, result.blobGasUsed, result.difficulty, result.excessBlobGas, result.extraData, result.gasLimit, result.hash, result.parentBeaconBlockRoot, result.receiptsRoot, result.size, result.stateRoot, result.timestamp, result.totalDifficulty, result.withdrawalsRoot

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x0",true]}
<< {"jsonrpc":"2.0","id":1,"result":{"baseFeePerGas":"0x3b9aca00","difficulty":"0x20000","extraData":"0x68697665636861696e","gasLimit":"0x23f3e20","gasUsed":"0x0","hash":"0x414c637788e37e9f65ed2c6ee962d32aeea39722ad50ee764e712fabebd69118","logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","miner":"0x0000000000000000000000000000000000000000","mixHash":"0x0000000000000000000000000000000000000000000000000000000000000000","nonce":"0x0000000000000000","number":"0x0","parentHash":"0x0000000000000000000000000000000000000000000000000000000000000000","receiptsRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","sha3Uncles":"0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347","size":"0x24f","stateRoot":"0x3f721d898239f0f78c63ec54498e1533ac29cdf335b5682a42f97d19b6e83e86","timestamp":"0x0","totalDifficulty":"0x20000","transactions":[],"transactionsRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","uncles":[],"withdrawals":[],"withdrawalsRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"}}
