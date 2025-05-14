// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { ITracerConfig } from './ITracerConfig';

export interface ITracerConfigWrapper {
  tracer?: TracerType;
  tracerConfig?: ITracerConfig;
}
