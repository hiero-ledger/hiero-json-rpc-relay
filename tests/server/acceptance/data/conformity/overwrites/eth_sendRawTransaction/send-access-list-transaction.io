// sends a transaction with access list
//
// Reason for override: We could not run the tests with the original chainId, as Hedera only supports chainIds
// within the limits of Java's Long, which is not the case for the conformity tests
// included in https://github.com/ethereum/execution-apis.
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
//     "access_list": "0x(...)",        // access list was NOT ignored!
//     "chain_id": "0x12a",
//     "type": 1,                       // type was NOT ignored!
//     "result": "SUCCESS",
//     ...
// }
//
// Although the transaction was signed and sent as type 0x1 with an access list,
// Note: This is the original test file, modified for our test purposes:
// https://github.com/ethereum/execution-apis/blob/main/tests/eth_sendRawTransaction/send-access-list-transaction.io

>> {"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x01f8808201288085a54f4c3c008301155894cdad5844f865f379bea057fb435aefef38361b688080d7d69429cbb51a44fd332c14180b4d471fbbc6654b1657c001a0e712360de4d3edc65ad14f712af2c87d09ccd73589803949816fb817075c0927a066b74193ee2af19d7c100f5f4620927de7cfa2f5e4fe2df432bbe26f436e9a94"]}
<< {"jsonrpc":"2.0","id":1,"result":"0xd07a55a00aeb93c7825d1ca42238abdc3bc225de097ee1b8b2a4a9240ae55f9c"}
