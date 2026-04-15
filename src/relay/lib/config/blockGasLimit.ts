// SPDX-License-Identifier: Apache-2.0

import { Utils } from '../../utils';
import constants from '../constants';

export interface VersionGasLimit {
  readonly version: string; // major.minor.patch format
  readonly gasLimit: number;
}

/**
 * Block gas limit configuration by HAPI version.
 * MUST be sorted in descending order by version number (e.g., 1.0.0, 0.69.0, 0.0.0) - see blockGasLimit.spec.ts
 */
export const BLOCK_GAS_LIMIT_BY_HAPI_VERSION: ReadonlyArray<VersionGasLimit> = [
  { version: '0.69.0', gasLimit: 150_000_000 },
  { version: '0.0.0', gasLimit: 30_000_000 },
];

/**
 * Returns the block gas limit based on the provided HAPI version. If the version is not provided or does not match any known versions, it returns a default gas limit.
 * @param hapiVersion the HAPI version string (e.g., "0.69.0")
 * @param config an optional array of VersionGasLimit objects to use for determining the gas limit. If not provided, the default configuration will be used.
 * @returns the block gas limit corresponding to the provided version, or a default value if the version is not recognized
 */

export const obtainBlockGasLimit = (
  hapiVersion?: string,
  config: ReadonlyArray<VersionGasLimit> = BLOCK_GAS_LIMIT_BY_HAPI_VERSION,
): number => {
  const normalizedHapiVersion = hapiVersion?.split(/[-+]/)[0];
  if (!normalizedHapiVersion || !Utils.VERSION_REGEX.test(normalizedHapiVersion)) {
    return constants.DEFAULT_BLOCK_GAS_LIMIT;
  }

  for (let i = 0; i < config.length; i++) {
    if (Utils.isVersionAtLeast(normalizedHapiVersion, config[i].version)) {
      return config[i].gasLimit;
    }
  }

  return constants.DEFAULT_BLOCK_GAS_LIMIT;
};
