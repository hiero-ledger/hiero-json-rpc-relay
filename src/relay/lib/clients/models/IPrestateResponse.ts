// SPDX-License-Identifier: Apache-2.0

export interface IPrestateAccountTrace {
  address: string;
  balance: string;
  code: string;
  nonce: number;
  storage: Record<string, string>;
}

export interface IPrestateResponse {
  pre: IPrestateAccountTrace[];
}
