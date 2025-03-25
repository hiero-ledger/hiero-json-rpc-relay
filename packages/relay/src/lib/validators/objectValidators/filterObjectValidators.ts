// SPDX-License-Identifier: Apache-2.0

import { predefined } from '../../errors/JsonRpcError';
import { IObjectValidatorDefinition } from '../../types';
import { BaseObjectValidator } from '.';

/**
 * Schema definition for filter objects
 */
export const FILTER_OBJECT: IObjectValidatorDefinition = {
  name: 'FilterObject',
  failOnUnexpectedParams: true,
  properties: {
    blockHash: {
      type: 'blockHash',
      nullable: false,
    },
    fromBlock: {
      type: 'blockNumber',
      nullable: false,
    },
    toBlock: {
      type: 'blockNumber',
      nullable: false,
    },
    address: {
      type: 'addressFilter',
      nullable: false,
    },
    topics: {
      type: 'topics',
      nullable: false,
    },
  },
};

/**
 * Filter object validator
 */
export class FilterObjectValidator extends BaseObjectValidator {
  constructor(filter: any) {
    super(FILTER_OBJECT, filter);
  }

  validate(): boolean {
    if (this.object.blockHash && (this.object.toBlock || this.object.fromBlock)) {
      throw predefined.INVALID_PARAMETER(0, "Can't use both blockHash and toBlock/fromBlock");
    }
    return super.validate();
  }
}
