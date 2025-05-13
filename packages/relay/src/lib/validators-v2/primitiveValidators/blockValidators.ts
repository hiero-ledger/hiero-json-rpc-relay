// SPDX-License-Identifier: Apache-2.0

import { IPrimitiveValidator } from '../../types';
import { ValidatorConstants, validateObject } from '../helper';
import { BlockHashObjectValidator, BlockNumberObjectValidator } from '../objectValidators';

/**
 * Block hash validator
 */
export const blockHashValidator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.BASE_HEX_REGEX + '{64}$').test(param),
  error: ValidatorConstants.BLOCK_HASH_ERROR,
};

/**
 * Block number validator
 */
export const blockNumberValidator: IPrimitiveValidator = {
  test: (param: string) =>
    (ValidatorConstants.BLOCK_NUMBER_REGEX.test(param) && Number.MAX_SAFE_INTEGER >= Number(param)) ||
    ValidatorConstants.ACCEPTABLE_BLOCK_TAGS.includes(param),
  error: ValidatorConstants.BLOCK_NUMBER_ERROR,
};

/**
 * Block parameters validator (hash/number/tag)
 */
export const blockParamsValidator: IPrimitiveValidator = {
  test: (param: any) => {
    if (Object.prototype.toString.call(param) === '[object Object]') {
      if (param.hasOwnProperty('blockHash')) {
        return validateObject(param, new BlockHashObjectValidator(param));
      }
      return validateObject(param, new BlockNumberObjectValidator(param));
    }
    return (
      (ValidatorConstants.BLOCK_NUMBER_REGEX.test(param) && Number.MAX_SAFE_INTEGER >= Number(param)) ||
      ValidatorConstants.ACCEPTABLE_BLOCK_TAGS.includes(param)
    );
  },
  error: ValidatorConstants.BLOCK_PARAMS_ERROR,
};
