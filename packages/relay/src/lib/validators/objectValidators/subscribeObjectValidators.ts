// SPDX-License-Identifier: Apache-2.0

import { predefined } from '../../errors/JsonRpcError';
import { IObjectValidatorDefinition } from '../../types';
import { BaseObjectValidator } from './baseObjectValidators';

export const ETH_SUBSCRIBE_LOGS_PARAMS_OBJECT: IObjectValidatorDefinition = {
  name: 'EthSubscribeLogsParamsObject',
  failOnUnexpectedParams: true,
  properties: {
    address: {
      type: 'addressFilter',
      nullable: false,
      required: false,
    },
    topics: {
      type: 'topics',
      nullable: false,
    },
  },
};

export class EthSubscribeLogsParamsObjectValidator extends BaseObjectValidator {
  constructor(param: any) {
    super(ETH_SUBSCRIBE_LOGS_PARAMS_OBJECT, param);
  }

  validate() {
    const valid = super.validate();
    // address and is not an empty array
    if (
      valid &&
      Array.isArray(this.object.address) &&
      this.object.address.length === 0 &&
      ETH_SUBSCRIBE_LOGS_PARAMS_OBJECT.properties.address.required
    ) {
      throw predefined.MISSING_REQUIRED_PARAMETER(`'address' for ${ETH_SUBSCRIBE_LOGS_PARAMS_OBJECT.name}`);
    }

    return valid;
  }
}
