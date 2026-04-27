// SPDX-License-Identifier: Apache-2.0

export interface IOpcode {
  pc?: number;
  op?: string;
  gas?: number;
  gas_cost?: number;
  depth?: number;
  stack?: string[];
  memory?: string[];
  storage?: { [key: string]: string };
  reason?: string | null;
}
