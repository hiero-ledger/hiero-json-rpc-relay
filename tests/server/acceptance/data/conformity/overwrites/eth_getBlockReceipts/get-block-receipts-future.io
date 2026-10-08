// gets receipts of future block
// Reason for override: The original test asks for block 0x15, which is in the future on the chain.rlp chain but
// already exists on our test network by the time the suite runs, so the relay returns that block's receipts.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getBlockReceipts/get-block-receipts-future.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["0x7fffffff"]}
<< {"jsonrpc":"2.0","id":1,"result":null}
