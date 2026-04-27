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

export type ITracerConfig = ICallTracerConfig | IOpcodeLoggerConfig;
