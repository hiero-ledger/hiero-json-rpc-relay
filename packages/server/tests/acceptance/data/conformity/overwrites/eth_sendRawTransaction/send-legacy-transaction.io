// sends a raw legacy transaction
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_sendRawTransaction/send-legacy-transaction.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0xf86c808405763d658261a894aa000000000000000000000000000000000000000a8255448718e5bb3abd109fa0c8e3b4a0087357bd49d80a0ac24daf0c91191e71086c1e355fc62cfab2218873a074f4636f740fa4d1697b6e736e5982b700be2c8b63031a24fa531ae4814b3af8"]}
<< {"jsonrpc":"2.0","id":1,"result":"0xeb51add00179bc30b868d0cc81509fd46fbfd9c11bdbac5714b8750be9248a18"}