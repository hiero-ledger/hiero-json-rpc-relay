// queries for logs with two topics, performing a wildcard match in topic position zero
>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":null,"fromBlock":"0x2","toBlock":"0x5","topics":[[],["0xb52248fb459b43720abbf1d5218c4ede9036a623653b31c2077991e04da9a456"]]}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"[Request ID: 06136dba-6e53-42a8-bd61-c39cea6a5884] Invalid parameter 'address' for FilterObject: Expected 0x prefixed string representing the address (20 bytes) or an array of addresses, value: null"}}
