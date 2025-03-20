// SPDX-License-Identifier: Apache-2.0

import { IParamValidation } from '../types';

/**
 * This key is attached to method functions to store their validation rules.
 */
export const RPC_PARAM_SCHEMA_KEY = 'hedera-rpc-param-schema';

/**
 * Decorator that defines a schema for validating RPC method parameters
 *
 * @example
 * ```typescript
 * @rpcMethod
 * @rpcParamSchema({
 *   0: { type: 'address', required: true },
 *   1: { type: 'blockNumber', required: true }
 * })
 * getBalance(address: string, blockNumber: string, requestDetails: RequestDetails): Promise<string> {
 *   // Implementation
 * }
 * ```
 *
 * @param validationSchema - Schema defining validation rules for method parameters
 * @returns Method decorator function
 */
export function rpcParamSchema(validationSchema: Record<number, IParamValidation>) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    // Store validation schema directly on the function as a property
    descriptor.value[RPC_PARAM_SCHEMA_KEY] = validationSchema;
    return descriptor;
  };
}
