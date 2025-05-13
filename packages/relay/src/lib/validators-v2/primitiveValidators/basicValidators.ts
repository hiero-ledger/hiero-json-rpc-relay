// SPDX-License-Identifier: Apache-2.0

import { IPrimitiveValidator } from '../../types';
import { ValidatorConstants, validateArray } from '../helper';

/**
 * Boolean validator
 */
export const booleanValidator: IPrimitiveValidator = {
  test: (param: boolean) => param === true || param === false,
  error: 'Expected boolean type',
};

/**
 * Hex string validator
 */
export const hexValidator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.BASE_HEX_REGEX + '*$').test(param),
  error: ValidatorConstants.DEFAULT_HEX_ERROR,
};

/**
 * Hex string with even length validator
 */
export const hexEvenLengthValidator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.BASE_HEX_REGEX + '*$').test(param) && !(param.length % 2),
  error: ValidatorConstants.EVEN_HEX_ERROR,
};

/**
 * Hex string with max 64 characters validator
 */
export const hex64Validator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.BASE_HEX_REGEX + '{1,64}$').test(param),
  error: ValidatorConstants.HASH_ERROR,
};

/**
 * Array validator
 */
export const arrayValidator: IPrimitiveValidator = {
  test: (param: any, innerType?: any) => {
    return Array.isArray(param) ? validateArray(param, innerType) : false;
  },
  error: 'Expected Array',
};
