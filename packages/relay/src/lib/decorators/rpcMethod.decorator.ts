// SPDX-License-Identifier: Apache-2.0

/**
 * Symbol key used to mark methods as RPC-enabled.
 * This key is attached to method functions to indicate they can be exposed via RPC.
 */
export const RPC_METHOD_KEY = 'hedera-rpc-method';

/**
 * TypeScript 5+ standard decorator that marks a class method as an RPC method.
 * This is the clean, modern version for TypeScript 5+ without legacy compatibility.
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
export function rpcMethod(target: any, context: ClassMethodDecoratorContext): any {
  context.addInitializer(function (this: any) {
    const methodName = String(context.name);
    if (this[methodName]) {
      this[methodName][RPC_METHOD_KEY] = true;
    }
  });

  // Also set it directly on the target function for immediate access
  target[RPC_METHOD_KEY] = true;

  return target;
}
