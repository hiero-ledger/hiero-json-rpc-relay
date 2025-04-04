// SPDX-License-Identifier: Apache-2.0

import { IMethodValidation } from '../types/validation';
import { validateParam } from './utils';

export function validateParams(params: any[], indexes: IMethodValidation) {
  for (const index of Object.keys(indexes)) {
    const validation = indexes[Number(index)];
    const param = params[Number(index)];

    validateParam(index, param, validation);
  }
}

export * from './constants';
export * from './types';
export * from './objectTypes';
export * from './utils';
export * as Validator from '.';
