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
 * @param target - The prototype of the class
 * @param context - The context of the method
 * @returns void
 */
export function rpcMethod(target: any, _context: ClassMethodDecoratorContext): void {
  target[RPC_METHOD_KEY] = true;
}
