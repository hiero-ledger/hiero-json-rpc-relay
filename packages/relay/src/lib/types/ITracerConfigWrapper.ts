// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { ICallTracerConfig, IOpcodeLoggerConfig, ITracerConfig } from './ITracerConfig';

export interface ITracerConfigWrapper extends Partial<ICallTracerConfig>, Partial<IOpcodeLoggerConfig> {
  tracer?: TracerType;
  tracerConfig?: ITracerConfig;
}
