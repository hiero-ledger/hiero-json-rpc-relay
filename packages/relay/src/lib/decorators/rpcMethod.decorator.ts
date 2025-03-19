// SPDX-License-Identifier: Apache-2.0

/**
 * Symbol key used to mark methods as RPC-enabled.
 * This key is attached to method functions to indicate they can be exposed via RPC.
 */
export const RPC_METHOD_KEY = 'hedera-rpc-method';

/**
 * Decorator that marks a class method as an RPC method.
 * When applied to a method, it marks that method as available for RPC invocation.
 *
 * @example
 * ```typescript
 * class NetImpl {
 *   @rpcMethod
 *   listening(): boolean {
 *     return false;
 *   }
 * }
 * ```
 *
 * @param _target - The prototype of the class (ignored in this implementation)
 * @param _propertyKey - The name of the method being decorated (ignored in this implementation)
 * @param descriptor - The property descriptor for the method
 * @returns The same property descriptor, allowing for decorator composition
 */
export function rpcMethod(_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
  descriptor.value[RPC_METHOD_KEY] = true;
  return descriptor;
}
