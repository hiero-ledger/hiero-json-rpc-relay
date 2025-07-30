// retrieves the client's current block number

// Reason for override:
// Every time the Hedera local node starts,
// the mirror-node-monitor service also starts along with it.
//
// This service pings the node every 2ms,
// consuming 0.00000001 HBAR each time,
// which causes the block number to continuously increase.
//
// As a result, we can't be certain what the latest block number is,
// making it difficult to predict the outcome in this test.

## wildcard: result

>> {"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}
<< {"jsonrpc":"2.0","id":1,"result":"0x74"}
