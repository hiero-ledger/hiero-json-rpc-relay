// gets block finalized
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBlockByNumber/get-finalized.io
//
// In the wildcard collection, there are fields that depend on the current state of the network,
// which changes with each test run.

## wildcard: result.hash, result.number, result.parentHash, result.size, result.timestamp

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",true]}
<< {"jsonrpc":"2.0","id":1,"result":{"baseFeePerGas":"0xa54f4c3c00","difficulty":"0x0","extraData":"0x","gasLimit":"0x1c9c380","gasUsed":"0x0","hash":"0x56e19bec2130baef148a7cefedc112a670a7417e7174e6e4ef402df919e847e2","logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","miner":"0x0000000000000000000000000000000000000000","mixHash":"0x0000000000000000000000000000000000000000000000000000000000000000","nonce":"0x0000000000000000","number":"0x94","parentHash":"0xf492a8b1048725dfdc34b15cedad6ad6f1023186ffa1137b2eb33e6345aa2107","receiptsRoot":"0x0000000000000000000000000000000000000000000000000000000000000000","sha3Uncles":"0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347","size":"0x683","stateRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","timestamp":"0x6866512d","totalDifficulty":"0x0","transactions":[],"transactionsRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","uncles":[],"withdrawals":[],"withdrawalsRoot":"0x0000000000000000000000000000000000000000000000000000000000000000"}}
