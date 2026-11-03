// checks that an error is returned if both `fromBlock` and `toBlock` are greater than the latest block
//
// Reason for override: The original block numbers are relative to the head of the chain.rlp block data (0x36):
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Our node's head is unrelated to it, so they are replaced with 0xfffffffe and 0xffffffff, blocks our node will
// never reach, which keeps the whole range past the head.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getLogs/filter-error-fully-future-block-range.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0xfffffffe","toBlock":"0xffffffff"}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"block range extends beyond current head block"}}
