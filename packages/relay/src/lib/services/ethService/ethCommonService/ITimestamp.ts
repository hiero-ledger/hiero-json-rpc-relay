// SPDX-License-Identifier: Apache-2.0

export interface ITimestamp {
  from: string;
  to: string;
}

export interface LatestBlockNumberTimestamp {
  blockNumber: string | null;
  timeStampTo: string;
}
