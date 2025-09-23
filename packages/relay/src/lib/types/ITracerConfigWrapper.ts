// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { IOpcodeLoggerConfig, ITracerConfig } from './ITracerConfig';

export interface ITracerConfigWrapper extends Partial<IOpcodeLoggerConfig> {
  tracer?: TracerType;
  tracerConfig?: ITracerConfig;
}
