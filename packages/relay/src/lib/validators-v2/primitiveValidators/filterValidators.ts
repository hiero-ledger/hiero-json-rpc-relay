// SPDX-License-Identifier: Apache-2.0

import { IPrimitiveValidator } from '../../types';
import { FilterObjectValidator } from '../objectValidators';
import { validateObject } from '../helper';

/**
 * Filter object validator
 */
export const filterValidator: IPrimitiveValidator = {
  test: (param: any) => {
    if (Object.prototype.toString.call(param) === '[object Object]') {
      return validateObject(param, new FilterObjectValidator(param));
    }
    return false;
  },
  error: 'Expected FilterObject',
};
