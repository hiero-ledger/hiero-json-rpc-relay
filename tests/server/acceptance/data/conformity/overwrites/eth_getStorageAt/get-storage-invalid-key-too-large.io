// requests an invalid storage key
// Reason for override: This test uses data included in the chain.rlp
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp
//
// Since we do not replay those transactions before starting the tests, we need a separate test that simulates
// the same scenario.
//
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_getStorageAt/get-storage-invalid-key-too-large.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_getStorageAt","params":["0xaa00000000000000000000000000000000000000","0x00000000000000000000000000000000000000000000000000000000000000000","latest"]}
<< {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"unable to decode storage key: hex string too long, want at most 32 bytes"}}
