// SPDX-License-Identifier: Apache-2.0

import { IObjectValidatorDefinition } from '../../types';
import { BaseObjectValidator } from '.';

/**
 * Object validator definition for block hash objects
 */
export const BLOCK_HASH_OBJECT: IObjectValidatorDefinition = {
  name: 'BlockHashObject',
  failOnUnexpectedParams: true,
  properties: {
    blockHash: {
      type: 'blockHash',
      nullable: false,
    },
  },
};

/**
 * Object validator definition for block number objects
 */
export const BLOCK_NUMBER_OBJECT: IObjectValidatorDefinition = {
  name: 'BlockNumberObject',
  failOnUnexpectedParams: true,
  properties: {
    blockNumber: {
      type: 'blockNumber',
      nullable: false,
    },
  },
};

/**
 * Block hash object validator
 */
export class BlockHashObjectValidator extends BaseObjectValidator {
  constructor(param: any) {
    super(BLOCK_HASH_OBJECT, param);
  }
}

/**
 * Block number object validator
 */
export class BlockNumberObjectValidator extends BaseObjectValidator {
  constructor(param: any) {
    super(BLOCK_NUMBER_OBJECT, param);
  }
}
