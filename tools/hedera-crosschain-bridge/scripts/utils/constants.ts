// SPDX-License-Identifier: Apache-2.0

interface IConstants {
  [key: string]: string | number;
}

export const constants: IConstants = {
  TOKEN_NAME: 'T_NAME',
  TOKEN_SYMBOL: 'T_SYMBOL',
  TOKEN_DECIMALS: 8,
};
