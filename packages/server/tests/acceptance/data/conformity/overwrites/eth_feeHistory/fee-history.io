// gets fee history information
//
// Reason for override:
// Hedera does not currently support blob-related fields (`baseFeePerBlobGas`, `blobGasUsedRatio`),
// so those fields have been omitted from the response.
// Reward will always be fed with a gasPrice value. This ensures that the json rpc clients will be able to
// correctly estimate the base fee per gas for the transactions that are being sent.
// Since in hedera the base fee per gas is always 0 (we are not burning gas), only the priority fee can be used
// to correctly estimate EIP-1559 fees.

## wildcard: result.baseFeePerBlobGas, result.blobGasUsedRatio, result.gasUsedRatio, result.reward, result.baseFeePerGas

>> {"jsonrpc":"2.0","id":1,"method":"eth_feeHistory","params":["0x1","0x2",[95,99]]}
<< {"jsonrpc":"2.0","id":1,"result":{"oldestBlock":"0x2","reward":[["0x0","0x0"]],"baseFeePerGas":["0x2dbf1f99","0x281d620d"],"gasUsedRatio":[0.007565458319646006],"baseFeePerBlobGas":["0x0","0x0"],"blobGasUsedRatio":[0]}}
