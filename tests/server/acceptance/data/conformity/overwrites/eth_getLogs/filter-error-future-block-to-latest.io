// checks that an error is returned if `fromBlock` is greater than the latest block and `toBlock` is `latest`
//
// Reason for override: The original block number is relative to the head of the chain.rlp block data (0x36):
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Our node's head is unrelated to it, so `fromBlock` is replaced with 0xffffffff, a block our node will never
// reach, which keeps it past the head.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getLogs/filter-error-future-block-to-latest.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0xffffffff","toBlock":"latest"}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"invalid block range params"}}
