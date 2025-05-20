// SPDX-License-Identifier: Apache-2.0
import { RPC_METHOD_KEY, RPC_PARAM_LAYOUT_KEY } from '../../decorators';
import { RpcMethodRegistry, RpcNamespaceRegistry } from '../../types';
import { RPC_PARAM_VALIDATION_RULES_KEY } from '../../validators';

/**
 * Registers RPC methods from the provided service implementations.
 *
 * This function scans each implementation instance for methods decorated with
 * the @rpcMethod decorator and registers them in a map using the convention
 * namespace_operationName (e.g., eth_blockNumber). The namespace is derived
 * from the implementation class name.
 *
 * @param {RpcNamespaceRegistry[]} rpcNamespaceRegistry - An array of objects
 * containing the namespace and corresponding service implementation.
 *
 * @returns {RpcMethodRegistry} A map where keys are RPC method names in the
 * format namespace_operationName, and values are the bound function implementations
 * of those methods.
 */
export function registerRpcMethods(rpcNamespaceRegistry: RpcNamespaceRegistry[]): RpcMethodRegistry {
  const registry: RpcMethodRegistry = new Map();

  rpcNamespaceRegistry.forEach(({ namespace, serviceImpl }) => {
    // Get the prototype to access the methods defined on the class
    const prototype = Object.getPrototypeOf(serviceImpl);

    // Find all method names on the prototype, excluding constructor
    Object.getOwnPropertyNames(prototype)
      .filter((operationName) => operationName !== 'constructor' && typeof prototype[operationName] === 'function')
      .forEach((operationName) => {
        const operationFunction = serviceImpl[operationName];

        // Only register methods that have been decorated with @rpcMethod (i.e. RPC_METHOD_KEY is true)
        if (operationFunction && operationFunction[RPC_METHOD_KEY] === true) {
          // Create the full RPC method ID in format: namespace_operationName (e.g., eth_blockNumber)
          const rpcMethodName = `${namespace}_${operationName}`;

          // Bind the method to the implementation instance to preserve the 'this' context
          const boundMethod = operationFunction.bind(serviceImpl);

          // Preserve the original operation name by redefining the name property as after binding the name value is modified
          Object.defineProperty(boundMethod, 'name', {
            value: operationName,
          });

          // Get validation rules if exists
          const validationRules = operationFunction[RPC_PARAM_VALIDATION_RULES_KEY];
          if (validationRules) {
            // Store validation rules with the method
            boundMethod[RPC_PARAM_VALIDATION_RULES_KEY] = validationRules;
          }

          // Get parameter layout if exists
          const parameterLayout = operationFunction[RPC_PARAM_LAYOUT_KEY];
          if (parameterLayout) {
            // Store parameter layout with the method
            boundMethod[RPC_PARAM_LAYOUT_KEY] = parameterLayout;
          }

          // Register the method with proper 'this' binding and original name
          registry.set(rpcMethodName, boundMethod);
        }
      });
  });

  return registry;
}
