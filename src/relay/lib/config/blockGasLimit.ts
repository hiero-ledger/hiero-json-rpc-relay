// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '../../../config-service/services';
import { Utils } from '../../utils';
import constants from '../constants';

export interface VersionGasLimit {
  readonly version: string; // major.minor.patch format
  readonly gasLimit: number;
}

/**
 * Block gas limit configuration by HAPI version, built per call so BLOCK_GAS_LIMIT overrides take effect.
 * MUST be sorted in descending order by version number (e.g., 1.0.0, 0.69.0, 0.0.0) - see blockGasLimit.spec.ts
 */
export const getBlockGasLimitByHapiVersion = (): ReadonlyArray<VersionGasLimit> => [
  { version: '0.69.0', gasLimit: ConfigService.get('BLOCK_GAS_LIMIT') },
  { version: '0.0.0', gasLimit: 30_000_000 },
];

/**
 * Compare two semver-like version strings ("major.minor.patch")
 * Returns true if version candidateVersion is greater than or equal to version minimumVersion, false otherwise.
 * Assumes that the version strings are well-formed and contain only numeric components.
 * @param candidateVersion string version
 * @param minimumVersion string version
 * @returns boolean true if a >= b, false otherwise
 * @example compareHapiVersions("0.69.0", "0.68.0") // returns true
 * @example compareHapiVersions("0.68.0", "0.69.0") // returns false
 * @example compareHapiVersions("0.69.0", "0.69.0") // returns true
 */
export function isHapiVersionAtLeast(candidateVersion: string, minimumVersion: string): boolean {
  const aParts = candidateVersion.split('.').map(Number);
  const bParts = minimumVersion.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;

    if (aPart > bPart) return true;
    if (aPart < bPart) return false;
  }

  return true;
}

/**
 * Returns the block gas limit based on the provided HAPI version. If the version is not provided or does not match any known versions, it returns a default gas limit.
 * @param hapiVersion the HAPI version string (e.g., "0.69.0")
 * @param config an optional array of VersionGasLimit objects to use for determining the gas limit. If not provided, the default configuration will be used.
 * @returns the block gas limit corresponding to the provided version, or a default value if the version is not recognized
 */

export const obtainBlockGasLimit = (
  hapiVersion?: string,
  config: ReadonlyArray<VersionGasLimit> = getBlockGasLimitByHapiVersion(),
): number => {
  const normalizedHapiVersion = hapiVersion?.split(/[-+]/)[0];
  if (!normalizedHapiVersion || !Utils.VERSION_REGEX.test(normalizedHapiVersion)) {
    return constants.DEFAULT_BLOCK_GAS_LIMIT;
  }

  for (let i = 0; i < config.length; i++) {
    if (isHapiVersionAtLeast(normalizedHapiVersion, config[i].version)) {
      return config[i].gasLimit;
    }
  }

  return constants.DEFAULT_BLOCK_GAS_LIMIT;
};
