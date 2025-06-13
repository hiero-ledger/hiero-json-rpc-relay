// retrieves the an account's balance at a specific blockhash
//
// Overwrite reason: block has was replaced by the one which exists in our local node prepared for the tests.
>> {"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df","0xed7b288c4f3ca719470d8bf870c644af4bfe9e05ba662c1a0f6d87df1ddf09d0"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x3f"}
