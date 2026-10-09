// checks that an error is returned if `fromBlock` is larger than `toBlock`
//
// Reason for override: The original test uses blocks 0x29 and 0x26 of the chain.rlp block data:
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp. On a fresh test node block 0x29 may not
// exist yet, in which case the relay returns [] for a range beyond head (tracked in
// https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5846) and the result depends on timing.
//
// Blocks 0x2 and 0x1 always exist, so the reversed range is tested deterministically. All other fields, and the
// expected response, are unchanged.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getLogs/filter-error-reversed-block-range.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x2","toBlock":"0x1"}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"invalid block range params"}}
