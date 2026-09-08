// SPDX-License-Identifier: Apache-2.0

export interface NetworkEnv {
  CHAIN_ID: string;
  HEDERA_NETWORK: string;
  MIRROR_NODE_URL: string;
  MIRROR_NODE_URL_WEB3: string;
}

export interface CliArgv {
  'read-only'?: boolean;
  'operator-id'?: string;
  'operator-key'?: string;
  'operator-key-format'?: string;
}

export type OperatorEnv =
  | { READ_ONLY: true }
  | {
      READ_ONLY: false;
      OPERATOR_ID_MAIN: string;
      OPERATOR_KEY_MAIN: string;
      OPERATOR_KEY_FORMAT: string;
    };

export interface StdioConfig {
  stdio: 'inherit' | ['ignore', 'pipe', 'pipe'];
  overrideStd: boolean;
}

export interface StoppableChild {
  pid?: number;
  on(event: string, listener: () => void): unknown;
  kill?(signal?: string): unknown;
}

export declare class CliHelper {
  static populateEnvBasedOnNetwork(network: string): NetworkEnv;
  static populateEnvBaseOnReadOnlyOption(argv: CliArgv): OperatorEnv;
  static gracefulStop(child: StoppableChild | null, spawn?: (...args: unknown[]) => unknown, parentPid?: number): void;
  static getStdio(loggingPath?: string | null): StdioConfig;
}
