// sends a transaction with dynamic fee and access list
// Reason for override: Combined EIP-1559 and EIP-2930 transactions are not supported on Hedera.
//
// The transaction was prepared with EIP-1559 (type: 0x2) and included an access list:
//
// const tx = {
//     type: "0x2",
//     maxFeePerGas, maxPriorityFeePerGas
//     chainId, nonce, gasLimit,
//     to, value,
//     accessList: [
//         {
//             address: "0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69",
//             storageKeys: [],
//         },
//     ],
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
//     "access_list": "0x",        // access list was ignored
//     "chain_id": "0x12a",
//     "type": 0,                  // transaction type downgraded to legacy
//     "result": "SUCCESS",
//     ...
// }
//
// Although the transaction was signed and sent as type 0x2 with a dynamic fee and access list,
// Hedera ignored both EIP-1559 fee parameters and the access list,
// treating the transaction as a legacy type (type 0).
// The field "access_list": "0x" confirms that Hedera currently does not support or process
// access lists defined in EIP-2930 nor dynamic fee structure from EIP-1559.

>> {"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x02f88c83aa36a78084773594008506fc23ac008261a89467d8d32e9bf1a9968a5ff53b87d777aa8ebbee69872386f26fc1000080d7d69467d8d32e9bf1a9968a5ff53b87d777aa8ebbee69c001a01b39fcf43c10acf60445c7b8796759bbe46b496d580953c559240c4d940c9dc4a00f866cb12cb33f7bff97cf8a8516cc1f8d3ab6fd3201ade6f4d1af5f92798d6b"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x1a60a6a335dfb2801c19ee64693769b5a1b156cad5ebcddc35267832324f7cfa"}