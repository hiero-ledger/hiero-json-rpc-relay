// SPDX-License-Identifier: Apache-2.0

import { BaseObjectValidator } from '.';
import { IObjectValidatorDefinition } from '../../types';

/**
 * Schema definition for transaction objects
 */
export const TRANSACTION_OBJECT: IObjectValidatorDefinition = {
  name: 'TransactionObject',
  failOnUnexpectedParams: false,
  deleteUnknownProperties: true,
  properties: {
    from: {
      type: 'address',
      nullable: false,
    },
    to: {
      type: 'address',
      nullable: true,
    },
    gas: {
      type: 'hex',
      nullable: false,
    },
    gasPrice: {
      type: 'hex',
      nullable: false,
    },
    maxPriorityFeePerGas: {
      type: 'hex',
      nullable: false,
    },
    maxFeePerGas: {
      type: 'hex',
      nullable: false,
    },
    value: {
      type: 'hex',
      nullable: false,
    },
    data: {
      type: 'hexEvenLength',
      nullable: true,
    },
    type: {
      type: 'hex',
      nullable: false,
    },
    chainId: {
      type: 'hex',
      nullable: false,
    },
    nonce: {
      type: 'hex',
      nullable: false,
    },
    input: {
      type: 'hex',
      nullable: false,
    },
    accessList: {
      type: 'array',
      nullable: false,
    },
  },
};

/**
 * Transaction object validator
 */
export class TransactionObjectValidator extends BaseObjectValidator {
  constructor(transaction: any) {
    super(TRANSACTION_OBJECT, transaction);
  }
}
