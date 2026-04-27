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
 * @param target - The method function
 * @param context - The decorator context
 * @returns The method function with RPC metadata attached
 */
export function rpcMethod(target: any, _context: ClassMethodDecoratorContext): any {
  target[RPC_METHOD_KEY] = true;

  return target;
}
