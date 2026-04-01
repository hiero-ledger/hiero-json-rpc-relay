// gets storage of a contract
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getStorageAt/get-storage.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getStorageAt","params":["0x7dcd17433742f4c0ca53122ab541d0ba67fc27df","0x0000000000000000000000000000000000000000000000000000000000000000","latest"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x0000000000000000000000000000000000000000000000000000000000000000"}
