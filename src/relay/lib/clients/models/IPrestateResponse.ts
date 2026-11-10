// SPDX-License-Identifier: Apache-2.0

export interface IPrestateAccountTrace {
  address: string;
  // Hex quantity in weibars, not tinybars.
  balance: string;
  // Null for accounts and for contracts with no runtime bytecode.
  code: string | null;
  nonce: number | null;
  storage: Record<string, string>;
}

export interface IPrestatePostAccountTrace {
  address: string;
  balance: string | null;
  code: string | null;
  nonce: number | null;
  storage: Record<string, string> | null;
}

export interface IPrestateResponse {
  pre: IPrestateAccountTrace[];
  post?: IPrestatePostAccountTrace[];
}
