// queries for logs from a specific contract across a range of blocks
>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"address":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df"],"fromBlock":"0x1","toBlock":"0x4","topics":null}]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"[Request ID: 312e9b88-53a1-433a-8f32-28e3acf1ba46] Invalid parameter 'topics' for FilterObject: Expected an array or array of arrays containing Expected 0x prefixed string representing the hash (32 bytes) of a topic, value: null"}}
