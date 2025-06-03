// Performs a call to the callenv contract, which echoes the EVM transaction environment.
// See https://github.com/ethereum/hive/tree/master/cmd/hivechain/contracts/callenv.eas for the output structure.
>> {"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x0000000000000000000000000000000000000000","to":"0x9344b07175800259691961298ca11c824e65032d"},"latest"]}
<< {"result":"0x","jsonrpc":"2.0","id":1}
