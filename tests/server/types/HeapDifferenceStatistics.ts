// SPDX-License-Identifier: Apache-2.0

import { type HeapSpaceStatistics, type HeapStatistics } from 'v8';

export type HeapDifferenceStatistics = Array<{
  gcType: string;
  cost: number;
  diffGC: {
    heapStatistics: HeapStatistics;
    heapSpaceStatistics: HeapSpaceStatistics[];
  };
}>;
