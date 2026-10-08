// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '../../../../../../src/config-service/services';
import { type TransactionResponse } from './interfaces';

export const RELAY_URL = 'http://127.0.0.1:7546';
export const WS_RELAY_URL = 'ws://127.0.0.1:8546';
export const chainId = Number(ConfigService.get('CHAIN_ID'));

export const sendAccountAddress = '0xc37f417fA09933335240FCA72DD257BFBdE9C275';
export const receiveAccountAddress = '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69';
export const gasPrice = '0x2C68AF0BB14000';
export const gasLimit = '0x3D090';
export const value = '0x2E90EDD000';
export const localNodeAccountPrivateKey = '0x6e9d61a325be3f6675cf8b7676c70e4a004d2308e3e182370a41f5653d52c6bd';
export const ETHEREUM_NETWORK_ACCOUNT_HASH = '0x5C41A21F14cFe9808cBEc1d91b55Ba75ed327Eb6';
export const EMPTY_TX_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const NONEXISTENT_TX_HASH = '0x00000000000000000000000000000000000000000000000000000000deadbeef';
export const EMIT_CONTRACT_ADDRESS = '0x28488325e19eb475cb72b05e797b41fda0bdc71e';
export const EMIT_INPUT = '0x01';
export const EMIT_LOG_TOPICS = [
  '0x00000000000000000000000000000000000000000000000000000000656d6974',
  '0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2',
];

export let currentBlockHash: string;
export let legacyTransactionAndBlockHash: TransactionResponse;
export let transaction2930AndBlockHash: TransactionResponse;
export let transaction1559AndBlockHash: TransactionResponse;
export let createContractLegacyTransactionAndBlockHash: TransactionResponse;
export let transaction1559_2930AndBlockHash: TransactionResponse;
export let hapiTransactionHash: string;
export let emitLogTransactionAndBlockHash: TransactionResponse;

export function setCurrentBlockHash(value: string): void {
  currentBlockHash = value;
}

export function setLegacyTransactionAndBlockHash(value: TransactionResponse): void {
  legacyTransactionAndBlockHash = value;
}

export function setTransaction2930AndBlockHash(value: TransactionResponse): void {
  transaction2930AndBlockHash = value;
}

export function setTransaction1559AndBlockHash(value: TransactionResponse): void {
  transaction1559AndBlockHash = value;
}

export function setTransaction1559_2930AndBlockHash(value: TransactionResponse): void {
  transaction1559_2930AndBlockHash = value;
}

export function setCreateContractLegacyTransactionAndBlockHash(value: TransactionResponse): void {
  createContractLegacyTransactionAndBlockHash = value;
}

export function setHapiTransactionHash(value: string): void {
  hapiTransactionHash = value;
}

export function setEmitLogTransactionAndBlockHash(value: TransactionResponse): void {
  emitLogTransactionAndBlockHash = value;
}
