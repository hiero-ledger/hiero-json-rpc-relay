// SPDX-License-Identifier: Apache-2.0

import { TransactionObjectValidator } from '../objectValidators';
import { validateObject, validateArray, ValidatorConstants } from '../helper';
import { IPrimitiveValidator } from '../../types';
/**
 * Transaction hash validator
 */
export const transactionHashValidator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.BASE_HEX_REGEX + '{64}$').test(param),
  error: ValidatorConstants.TRANSACTION_HASH_ERROR,
};

/**
 * Transaction ID validator
 */
export const transactionIdValidator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.TRANSACTION_ID_REGEX).test(param),
  error: ValidatorConstants.TRANSACTION_ID_ERROR,
};

/**
 * Transaction object validator
 */
export const transactionValidator: IPrimitiveValidator = {
  test: (param: any) => {
    if (Object.prototype.toString.call(param) === '[object Object]') {
      return validateObject(param, new TransactionObjectValidator(param));
    }
    return false;
  },
  error: 'Expected TransactionObject',
};

/**
 * Topic hash validator
 */
export const topicHashValidator: IPrimitiveValidator = {
  test: (param: string) => new RegExp(ValidatorConstants.BASE_HEX_REGEX + '{64}$').test(param) || param === null,
  error: ValidatorConstants.TOPIC_HASH_ERROR,
};

/**
 * Topics validator (array of topic hashes)
 */
export const topicsValidator: IPrimitiveValidator = {
  test: (param: string[] | string[][]) => {
    return Array.isArray(param) ? validateArray(param.flat(), 'topicHash') : false;
  },
  error: `Expected an array or array of arrays containing ${ValidatorConstants.HASH_ERROR} of a topic`,
};
