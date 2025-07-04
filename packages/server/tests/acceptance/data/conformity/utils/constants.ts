// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

export const RELAY_URL = 'http://127.0.0.1:7546';
export const WS_RELAY_URL = 'ws://127.0.0.1:8546';
export const chainId = Number(ConfigService.get('CHAIN_ID'));

export const sendAccountAddress = '0xc37f417fA09933335240FCA72DD257BFBdE9C275';
export const receiveAccountAddress = '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69';
export const gasPrice = '0x2C68AF0BB14000';
export const gasLimit = '0x3D090';
export const value = '0x2E90EDD000';
export const localNodeAccountPrivateKey = '0x6e9d61a325be3f6675cf8b7676c70e4a004d2308e3e182370a41f5653d52c6bd';
export const ETHEREUM_NETWORK_BLOCK_HASH = '0xac5c61edb087a51279674fe01d5c1f65eac3fd8597f9bea215058e745df8088e';
export const ETHEREUM_NETWORK_SIGNED_TRANSACTION =
  '0xf86709843b9aca018261a894aa000000000000000000000000000000000000000a825544820a95a0281582922adf6475f5b2241f0a4f886dafa947ecdc5913703b7840344a566b45a05f685fc099161126637a12308f278a8cd162788a6c6d5aee4d425cde261ba35d';
export const ETHEREUM_NETWORK_ACCOUNT_HASH = '0x5C41A21F14cFe9808cBEc1d91b55Ba75ed327Eb6';
export const EMPTY_TX_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const NONEXISTENT_TX_HASH = '0x00000000000000000000000000000000000000000000000000000000deadbeef';

export let currentBlockHash: any;
export let legacyTransactionAndBlockHash: any;
export let transaction2930AndBlockHash: any;
export let transaction1559AndBlockHash: any;
export let createContractLegacyTransactionAndBlockHash: any;
export let transaction1559_2930AndBlockHash: any;

export function setCurrentBlockHash(value: any) {
  currentBlockHash = value;
}

export function setLegacyTransactionAndBlockHash(value: any) {
  legacyTransactionAndBlockHash = value;
}

export function setTransaction2930AndBlockHash(value: any) {
  transaction2930AndBlockHash = value;
}

export function setTransaction1559AndBlockHash(value: any) {
  transaction1559AndBlockHash = value;
}

export function setTransaction1559_2930AndBlockHash(value: any) {
  transaction1559_2930AndBlockHash = value;
}

export function setCreateContractLegacyTransactionAndBlockHash(value: any) {
  createContractLegacyTransactionAndBlockHash = value;
}
