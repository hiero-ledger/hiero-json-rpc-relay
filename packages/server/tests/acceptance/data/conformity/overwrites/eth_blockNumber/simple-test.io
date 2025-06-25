// retrieves the client's current block number
// Reason for override: In our test case scenario, additional blocks are already prepared before the tests start.
// These extra blocks are needed to submit missing smart contracts.
// That's why block number 20 is replaced by 29 in the response.
>> {"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}
<< {"jsonrpc":"2.0","id":1,"result":"0x1d"}
