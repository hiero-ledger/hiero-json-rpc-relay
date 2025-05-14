// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { ICallTracerConfig, ITracerConfig } from './ITracerConfig';

export interface ITracerConfigWrapper {
  tracer?: TracerType;
  tracerConfig?: ITracerConfig;
}

export interface BlockTracerConfig {
  tracer: TracerType;
  tracerConfig?: ICallTracerConfig;
}
