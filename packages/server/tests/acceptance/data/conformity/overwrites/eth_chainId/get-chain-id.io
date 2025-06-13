// retrieves the client's current chain id
//
// Reason for override: The Exec API tests used the value 0xc72dd9d5e883e for the chain ID,
// but this value exceeds the integer range allowed by Hedera, where the chain ID must fit within a valid integer type.
// Therefore, the file was overwritten with the chain ID value that is actually used by default on our local network.
>> {"jsonrpc":"2.0","id":1,"method":"eth_chainId"}
<< {"jsonrpc":"2.0","id":1,"result":"0x12a"}
