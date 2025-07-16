// SPDX-License-Identifier: Apache-2.0

import { predefined } from '../errors/JsonRpcError';
import { TYPES } from './types';
import { requiredIsMissing } from './utils';

/**
 * Represents a validation rule for a parameter
 */
export interface IParamValidation {
  /**
   * The type of parameter to validate against
   * Can be a ParamType enum value or a compound type string with pipe symbol (e.g., 'blockNumber|blockHash')
   */
  type: keyof typeof TYPES | (keyof typeof TYPES)[];

  /**
   * Whether the parameter is required
   */
  required: boolean;

  /**
   * The error message to return if the parameter is invalid
   */
  errorMessage?: string;
}

/**
 * This key is attached to method functions to store their validation rules.
 */
export const RPC_PARAM_VALIDATION_RULES_KEY = 'hedera-rpc-param-validation-rules';

/**
 * Decorator that defines a schema for validating RPC method parameters
 *
 * @example
 * ```typescript
 * @rpcMethod
 * @rpcParamValidationRules({
 *   0: { type: 'address', required: true },
 *   1: { type: 'blockNumber', required: true }
 * })
 * getBalance(address: string, blockNumber: string, requestDetails: RequestDetails): Promise<string> {
 *   // Implementation
 * }
 * ```
 *
 * @param validationRules - Validation rules for method parameters
 * @returns Method decorator function
 */
export function rpcParamValidationRules(validationRules: Record<number, IParamValidation>) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    // Store validation rules directly on the function as a property
    descriptor.value[RPC_PARAM_VALIDATION_RULES_KEY] = validationRules;
    return descriptor;
  };
}

export function validateParams(params: any[], indexes: { [index: number]: IParamValidation }) {
  if (params.length > Object.keys(indexes).length) {
    throw predefined.INVALID_PARAMETERS;
  }

  for (const index of Object.keys(indexes)) {
    const validation = indexes[Number(index)];
    const param = params[Number(index)];

    validateParam(index, param, validation);
  }
}

function validateParam(index: number | string, param: any, validation: IParamValidation): void {
  const paramType = Array.isArray(validation.type)
    ? validation.type.map((type) => TYPES[type])
    : TYPES[validation.type];

  if (paramType === undefined) {
    throw predefined.INTERNAL_ERROR(`Missing or unsupported param type '${validation.type}'`);
  }

  if (requiredIsMissing(param, validation.required)) {
    throw predefined.MISSING_REQUIRED_PARAMETER(index);
  } else if (!validation.required && param === undefined) {
    //if parameter is undefined and not required, no need to validate
    //e.g estimateGas method, blockNumber is not required
    return;
  }

  if (param === null) {
    throw predefined.INVALID_PARAMETER(index, `The value passed is not valid: ${param}.`);
  }

  if (Array.isArray(paramType)) {
    const results = paramType.map((validator) => validator.test(param));
    if (!results.includes(true)) {
      const errorMessages = paramType.map((validator) => validator.error).join(' OR ');
      throw predefined.INVALID_PARAMETER(index, `The value passed is not valid: ${param}. ${errorMessages}`);
    }
  } else if (!paramType.test(param)) {
    const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
    throw predefined.INVALID_PARAMETER(index, `${paramType.error}, value: ${paramString}`);
  }
}

export { TYPES } from './types';
export { OBJECTS_VALIDATIONS } from './objectTypes';
export { validateEthSubscribeLogsParamObject } from './objectTypes';
export * as Constants from './constants';
