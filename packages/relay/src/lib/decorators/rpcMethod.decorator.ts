// SPDX-License-Identifier: Apache-2.0

/**
 * Symbol key used to mark methods as RPC-enabled.
 * This key is attached to method functions to indicate they can be exposed via RPC.
 */
export const RPC_METHOD_KEY = 'hedera-rpc-method';

/**
 * Decorator that marks a class method as an RPC method (TypeScript 4.x with --experimentalDecorators).
 * When applied to a method, it marks that method as available for RPC invocation.
 *
 * For TypeScript 5+ standard decorators, use @rpcMethodStandard instead.
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

/**
 * TypeScript 5+ standard decorator that marks a class method as an RPC method.
 * This is the clean, modern version for TypeScript 5+ without legacy compatibility.
 *
 * @example
 * ```typescript
 * class NetImpl {
 *   @rpcMethodStandard
 *   listening(): boolean {
 *     return false;
 *   }
 * }
 * ```
 *
 * @param target - The prototype of the class
 * @param context - The context of the method
 * @returns void
 */
export function rpcMethodStandard(target: any, _context: any /* ClassMethodDecoratorContext - requires TS5+ */): void {
  target[RPC_METHOD_KEY] = true;
}
