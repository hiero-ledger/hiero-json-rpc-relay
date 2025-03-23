// SPDX-License-Identifier: Apache-2.0

import { IParamValidation } from '../types';

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
