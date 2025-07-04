// sends a transaction with access list
// Reason for override: Hedera JSON-RPC does not support access lists defined in EIP-2930.
//
// The transaction was prepared with EIP-2930 structure:
//
// const tx = {
//     type: "0x1",
//     chainId, nonce, gas, gasPrice, to, value,
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
// path=/contracts/results/0x4d8eaa41ae21302cac9b746a7aa9007231dd774e04afca6702f95ef67b5d9194
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
// Although the transaction was signed and sent as type 0x1 with an access list,
// Hedera ignored the accessList field and treated it as a legacy (type 0) transaction.
// The field "access_list": "0x" confirms that Hedera currently does not support or process EIP-2930 access lists.

>> {"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x01f88783aa36a7808504a817c8008261a89467d8d32e9bf1a9968a5ff53b87d777aa8ebbee69872386f26fc1000080d7d69467d8d32e9bf1a9968a5ff53b87d777aa8ebbee69c001a033f979b49e404e079e6efdcd24f461f776dbffa64cbe46a30241fe378da6c68da02423fbd1c1e50eeae47e50918b4821ad20ff9f370d9984439c039f1610c2664d"]}
<< {"jsonrpc":"2.0","id":1,"result":"0x4d8eaa41ae21302cac9b746a7aa9007231dd774e04afca6702f95ef67b5d9194"}