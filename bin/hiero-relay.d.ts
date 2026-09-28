// SPDX-License-Identifier: Apache-2.0

export interface RunDependencies {
  fsDep?: unknown;
  spawnDep?: unknown;
  dotenvDep?: unknown;
  CliHelperDep?: unknown;
  consoleDep?: unknown;
  processDep?: unknown;
}

export declare function run(argvInput?: string[], deps?: RunDependencies): void;
