// queries for logs in a block, identified by blockHash
//
// Reason for override: This test queries a block of the chain.rlp block data:
// https://github.com/ethereum/execution-apis/blob/main/tests/chain.rlp, whose logs come from a log emitter contract.
//
// The same emitter (identical runtime code) is deployed by the 4th entry of `genesis.json`, and the conformity setup
// calls it once with input `0x01`, which logs topics ["emit", keccak256(0x01)] and the call counter (0) as data.
// `params[0]` is replaced at runtime with the hash of that call's block and those two topics (see `overwrites.ts`).
// Fields that differ on every run are wildcarded; the log's address, topics, data and indexes are compared.
//
// Note: This is the original test file, modified for our test purposes: https://github.com/ethereum/execution-apis/blob/main/tests/eth_getLogs/filter-with-blockHash-and-topics.io

## wildcard: result[0].blockHash, result[0].blockNumber, result[0].blockTimestamp, result[0].transactionHash, result[0].transactionIndex

>> {"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"blockHash":"0x29cc6f97784c864cbe29b3502934ad874f48ddc89580018f5a32e01652c88f0a","topics":[["0x00000000000000000000000000000000000000000000000000000000656d6974"],["0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2"]]}]}
<< {"jsonrpc":"2.0","id":1,"result":[{"address":"0x28488325e19eb475cb72b05e797b41fda0bdc71e","topics":["0x00000000000000000000000000000000000000000000000000000000656d6974","0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2"],"data":"0x0000000000000000000000000000000000000000000000000000000000000000","blockNumber":"0x4","transactionHash":"0xf047c5133c96c405a79d01038b4ccf8208c03e296dd9f6bea083727c9513f805","transactionIndex":"0x0","blockHash":"0x29cc6f97784c864cbe29b3502934ad874f48ddc89580018f5a32e01652c88f0a","blockTimestamp":"0x28","logIndex":"0x0","removed":false}]}
