// SPDX-License-Identifier: Apache-2.0

export interface ICallTracerConfig {
  onlyTopCall?: boolean;
}

export interface IOpcodeLoggerConfig {
  enableMemory?: boolean;
  disableStack?: boolean;
  disableStorage?: boolean;
  fullStorage?: boolean; // Non-standard parameter sometimes sent by Remix - ignored in implementation
}

export interface IPrestateTracerConfig {
  disableCode?: boolean;
  disableStorage?: boolean;
  includeEmpty?: boolean;
  diffMode?: boolean;
}

export type ITracerConfig = ICallTracerConfig | IOpcodeLoggerConfig | IPrestateTracerConfig;
