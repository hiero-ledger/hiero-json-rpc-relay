// SPDX-License-Identifier: Apache-2.0

import { IPrimitiveValidator } from '../../types';
import { validateArray, ValidatorConstants } from '../helper';

/**
 * Address validator
 */
export const addressValidator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.BASE_HEX_REGEX + '{40}$').test(param),
  error: ValidatorConstants.ADDRESS_ERROR,
};

/**
 * Address filter validator (single address or array of addresses)
 */
export const addressFilterValidator: IPrimitiveValidator = {
  test: (param: string | string[]) => {
    return Array.isArray(param)
      ? validateArray(param.flat(), 'address')
      : new RegExp(ValidatorConstants.BASE_HEX_REGEX + '{40}$').test(param);
  },
  error: `${ValidatorConstants.ADDRESS_ERROR} or an array of addresses`,
};
