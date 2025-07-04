// SPDX-License-Identifier: Apache-2.0
import { bytecode } from '../../../../contracts/Basic.json';
import { chainId, gasLimit, gasPrice, receiveAccountAddress, sendAccountAddress, value } from './constants';

export const legacyTransaction: any = {
  chainId,
  to: receiveAccountAddress,
  from: sendAccountAddress,
  value,
  gasPrice,
  gasLimit: gasLimit,
  type: 0,
};

export const transaction2930 = {
  chainId,
  to: receiveAccountAddress,
  from: sendAccountAddress,
  value,
  gasPrice,
  gasLimit: gasLimit,
  type: 0x1,
  accessList: [],
};

export const transaction1559 = {
  chainId,
  to: receiveAccountAddress,
  from: sendAccountAddress,
  value,
  gasPrice,
  maxPriorityFeePerGas: gasPrice,
  maxFeePerGas: gasPrice,
  gasLimit: gasLimit,
  type: 0x2,
};

export const transaction1559_2930 = {
  chainId,
  to: receiveAccountAddress,
  from: sendAccountAddress,
  value,
  gasPrice,
  maxPriorityFeePerGas: gasPrice,
  maxFeePerGas: gasPrice,
  gasLimit: gasLimit,
  type: 0x2,
  accessList: [],
};

export const createContractLegacyTransaction = {
  chainId,
  to: null,
  from: sendAccountAddress,
  gasLimit: gasLimit,
  gasPrice: gasPrice,
  type: 0x0,
  data: bytecode,
};
