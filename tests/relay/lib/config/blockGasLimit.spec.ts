// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { describe } from 'mocha';

import {
  BLOCK_GAS_LIMIT_BY_HAPI_VERSION,
  isHapiVersionAtLeast,
  obtainBlockGasLimit,
  type VersionGasLimit,
} from '../../../../src/relay/lib/config/blockGasLimit';
import constants from '../../../../src/relay/lib/constants';

const TEST_CONFIG_FULL: ReadonlyArray<VersionGasLimit> = [
  { version: '1.1.0', gasLimit: 350_000_000 },
  { version: '1.0.2', gasLimit: 300_000_000 },
  { version: '1.0.0', gasLimit: 250_000_000 },
  { version: '0.70.0', gasLimit: 200_000_000 },
  { version: '0.69.0', gasLimit: 150_000_000 },
  { version: '0.0.0', gasLimit: 30_000_000 },
];

describe('blockGasLimit', () => {
  it('BLOCK_GAS_LIMIT_BY_HAPI_VERSION must be sorted in descending order', () => {
    for (let i = 1; i < BLOCK_GAS_LIMIT_BY_HAPI_VERSION.length; i++) {
      const prev = BLOCK_GAS_LIMIT_BY_HAPI_VERSION[i - 1].version;
      const curr = BLOCK_GAS_LIMIT_BY_HAPI_VERSION[i].version;
      expect(isHapiVersionAtLeast(prev, curr)).to.be.true;
    }
  });

  it('should return the default gas limit when no HAPI version is provided', () => {
    const defaultGasLimit = obtainBlockGasLimit(undefined);
    expect(defaultGasLimit).to.equal(constants.DEFAULT_BLOCK_GAS_LIMIT);
  });

  it('should return default gas limit for empty or malformed version strings', () => {
    expect(obtainBlockGasLimit('')).to.equal(constants.DEFAULT_BLOCK_GAS_LIMIT);
  });

  it('should handle partial or malformed version strings gracefully', () => {
    expect(obtainBlockGasLimit('0.69')).to.equal(constants.DEFAULT_BLOCK_GAS_LIMIT);
    expect(obtainBlockGasLimit('bad.version.x')).to.equal(constants.DEFAULT_BLOCK_GAS_LIMIT);
  });

  it('should strip pre-release and build metadata identifiers, returning only "major.minor.patch"', () => {
    expect(obtainBlockGasLimit('0.68.0-node-alpha')).to.equal(constants.DEFAULT_BLOCK_GAS_LIMIT);
    expect(obtainBlockGasLimit('1.0.0-node-alpha')).to.equal(150_000_000);
  });

  it('should correctly resolve gas limit when patch version changes within a range', () => {
    // All 0.68.x < 0.69.0 should return 30M
    expect(obtainBlockGasLimit('0.68.1')).to.equal(30_000_000);
    expect(obtainBlockGasLimit('0.68.50')).to.equal(30_000_000);
    expect(obtainBlockGasLimit('0.68.999')).to.equal(30_000_000);
  });

  it('should correctly resolve gas limit when minor version changes within a range', () => {
    // 0.1.x through 0.68.x should return 30M
    expect(obtainBlockGasLimit('0.1.0')).to.equal(30_000_000);
    expect(obtainBlockGasLimit('0.50.0')).to.equal(30_000_000);
    expect(obtainBlockGasLimit('0.68.999')).to.equal(30_000_000);
  });

  it('should correctly resolve gas limit when major version increases', () => {
    // Major version bump should still pick the last (highest) applicable entry
    expect(obtainBlockGasLimit('1.0.0')).to.equal(150_000_000);
    expect(obtainBlockGasLimit('2.5.3')).to.equal(150_000_000);
  });

  it('should return the correct gas limit for versions that are higher than the last known version', () => {
    // All >= 0.69.x should return 150M
    expect(obtainBlockGasLimit('0.69.0')).to.equal(150_000_000);
    expect(obtainBlockGasLimit('0.69.1')).to.equal(150_000_000);
    expect(obtainBlockGasLimit('0.70.0')).to.equal(150_000_000);
    expect(obtainBlockGasLimit('99.0.0')).to.equal(150_000_000);
  });

  describe('with extended test version config', () => {
    it('should return the correct gas limit for known HAPI versions', () => {
      for (const { version, gasLimit } of TEST_CONFIG_FULL) {
        const result = obtainBlockGasLimit(version, TEST_CONFIG_FULL);
        expect(result).to.equal(
          gasLimit,
          `Expected gas limit ${gasLimit} for HAPI version ${version}, but got ${result}`,
        );
      }
    });

    it('should return the gas limit of the nearest lower bound for versions between known entries', () => {
      const testCases = [
        { hapi_version: '0.0.1', expectedGasLimit: 30_000_000 },
        { hapi_version: '0.69.1', expectedGasLimit: 150_000_000 },
        { hapi_version: '0.80.0', expectedGasLimit: 200_000_000 },
        { hapi_version: '1.0.1', expectedGasLimit: 250_000_000 },
        { hapi_version: '1.0.5', expectedGasLimit: 300_000_000 },
        { hapi_version: '1.1.5', expectedGasLimit: 350_000_000 },
      ];
      for (const { hapi_version, expectedGasLimit } of testCases) {
        const gasLimit = obtainBlockGasLimit(hapi_version, TEST_CONFIG_FULL);
        expect(gasLimit).to.equal(
          expectedGasLimit,
          `Expected gas limit ${expectedGasLimit} for HAPI version ${hapi_version}, but got ${gasLimit}`,
        );
      }
    });
  });
});
