// checks that an error is returned if `toBlock` is greater than the latest block
//
// Reason for override: The original block numbers are relative to the head of the chain.rlp block data (0x36):
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Our node's head is unrelated to it, so they are replaced with 0x0 and 0xffffffff, a block our node will never
// reach, which keeps the range starting below the head and ending past it.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getLogs/filter-error-future-block-range.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x0","toBlock":"0xffffffff"}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"block range extends beyond current head block"}}
