// SPDX-License-Identifier: Apache-2.0

export interface IFeeHistory {
  baseFeePerGas: string[] | undefined;
  gasUsedRatio: number[] | null;
  oldestBlock: string;
  reward?: string[][];
}
