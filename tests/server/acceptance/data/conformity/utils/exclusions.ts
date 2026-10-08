// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';

/**
 * Upstream execution-apis fixtures that are not run against the relay, each with the reason.
 * A key is either a method (excludes all of its fixtures) or a single `method/file.io` fixture.
 * Only upstream fixtures are excluded; Hedera overwrites always run.
 */
export const EXCLUDED_FIXTURES: Readonly<Record<string, string>> = {
  eth_createAccessList: 'not implemented, the relay always returns -32601',
  eth_getProof: 'not implemented, the relay always returns -32601',
  eth_simulateV1: 'not implemented, the relay always returns -32601',
  'eth_blobBaseFee/get-current-blobfee.io': 'not implemented, Hedera has no blobs',
  'eth_estimateGas/estimate-with-eip4844.io': 'blob transaction fields are not supported on Hedera',
  'eth_estimateGas/estimate-with-eip7702.io': 'EIP-7702 is not yet supported on Hedera',
  'eth_getLogs/filter-error-future-block-range.io':
    'the relay returns [] instead of -32602 for a range beyond head, see https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/5846',
};

/**
 * Returns why an upstream fixture is excluded, or `undefined` if it should run.
 */
export function getExclusionReason(method: string, file: string): string | undefined {
  return EXCLUDED_FIXTURES[`${method}/${file}`] ?? EXCLUDED_FIXTURES[method];
}

/**
 * Returns the exclusion keys that match no upstream fixture, e.g. after a spec bump renamed or removed one.
 */
export function findUnmatchedExclusions(fixturesDirectory: string): string[] {
  return Object.keys(EXCLUDED_FIXTURES).filter((key) => !fs.existsSync(path.join(fixturesDirectory, key)));
}
