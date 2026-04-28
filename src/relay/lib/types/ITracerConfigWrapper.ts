// SPDX-License-Identifier: Apache-2.0

import { type TracerType } from '../constants';
import { type IOpcodeLoggerConfig, type ITracerConfig } from './ITracerConfig';

export interface ITracerConfigWrapper extends Partial<IOpcodeLoggerConfig> {
  tracer?: TracerType;
  tracerConfig?: ITracerConfig;
}
