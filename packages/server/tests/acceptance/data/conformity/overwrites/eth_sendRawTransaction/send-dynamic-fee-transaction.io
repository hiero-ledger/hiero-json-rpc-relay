// sends a create transaction with dynamic fee
// Reason for override: Hedera JSON-RPC does not support dynamic fee transactions as defined in EIP-1559.
//
// The transaction was prepared with EIP-1559 structure:
//
// const tx = {
//     type: "0x2",
//     chainId, nonce, to, value, gas,
//     maxFeePerGas, maxPriorityFeePerGas,
// };
//
// The transaction was successfully received by the Hedera mirror node:
//
// Response from mirror node (status=200):
// method=GET
// path=/contracts/results/0x1a60a6a335dfb2801c19ee64693769b5a1b156cad5ebcddc35267832324f7cfa
//
// Part of the response:
// {
//     "type": 0,                        // transaction type downgraded to legacy
//     "gas_price": "0x1312d0",          // classic gas price used instead of EIP-1559 fields
//     "max_fee_per_gas": "0x",          // ignored
//     "max_priority_fee_per_gas": "0x", // ignored
//     "chain_id": "0x12a",
//     "result": "SUCCESS",
//     ...
// }
//
// Although the transaction was signed and sent as type 0x2 with dynamic fee parameters,
// Hedera ignored the EIP-1559-specific fields and processed it as a legacy transaction (type 0).
// The presence of "max_fee_per_gas": "0x" and "type": 0 confirms that Hedera currently does not support dynamic fee transactions as defined in EIP-1559.

>> {"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":[" 0x02f87583aa36a78084773594008506fc23ac008261a89467d8d32e9bf1a9968a5ff53b87d777aa8ebbee69872386f26fc1000080c080a08b3d60fb1acec0d7f9f65561c13783e02d2c9d7d301493cece3b82375066ef36a020dc52be8de0ca284323a12687a6124a7c22f01ded937217c411ed5a4d7af93d"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x1a60a6a335dfb2801c19ee64693769b5a1b156cad5ebcddc35267832324f7cfa"}