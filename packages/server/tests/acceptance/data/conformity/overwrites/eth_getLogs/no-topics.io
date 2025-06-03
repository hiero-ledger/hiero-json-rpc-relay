// queries for all logs across a range of blocks
>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":null,"fromBlock":"0x1","toBlock":"0x3","topics":null}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"[Request ID: 8dc42b0d-fb94-4814-912b-401654d45e11] Invalid parameter 'address' for FilterObject: Expected 0x prefixed string representing the address (20 bytes) or an array of addresses, value: null"}}
