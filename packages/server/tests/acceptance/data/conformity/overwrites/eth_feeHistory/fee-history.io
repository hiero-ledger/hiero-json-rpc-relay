// gets fee history information
//
// Reason for override:
// Hedera does not currently support blob-related fields (`baseFeePerBlobGas`, `blobGasUsedRatio`),
// so those fields have been omitted from the response.

## wildcard: result.baseFeePerBlobGas, result.blobGasUsedRatio, result.gasUsedRatio, result.baseFeePerGas

>> {"jsonrpc":"2.0","id":1,"method":"eth_feeHistory","params":["0x1","0x2",[95,99]]}
<< {"jsonrpc":"2.0","id":1,"result":{"oldestBlock":"0x2","reward":[["0x0","0x0"]],"baseFeePerGas":["0x2dbf1f99","0x281d620d"],"gasUsedRatio":[0.007565458319646006],"baseFeePerBlobGas":["0x0","0x0"],"blobGasUsedRatio":[0]}}
