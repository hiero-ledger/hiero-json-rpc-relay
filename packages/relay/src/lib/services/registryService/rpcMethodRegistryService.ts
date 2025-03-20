// SPDX-License-Identifier: Apache-2.0
import { RPC_METHOD_KEY, RPC_PARAM_SCHEMA_KEY } from '../../decorators';
import { RpcImplementation, RpcMethodRegistry } from '../../types';

/**
 * This class maintains a registry of methods that have been marked as
 * available for RPC invocation using the @rpcMethod decorator.
 * It provides functionality to register, lookup, and manage these RPC-exposed methods.
 */
export class RpcMethodRegistryService {
  /**
   * Creates and registers RPC methods from the provided service implementations
   *
   * This static method scans each implementation instance for methods decorated with
   * @rpcMethod and registers them in a map using the convention namespace_operationName
   * (e.g., eth_blockNumber). The namespace is derived from the implementation class name.
   *
   * @param {RpcImplementation[]} implementations - Array of implementation instances containing RPC methods to register
   * @returns {RpcMethodRegistry} A map of RPC method names to their bound function implementations
   */
  public static register(implementations: RpcImplementation[]): RpcMethodRegistry {
    const registry: RpcMethodRegistry = new Map();

    implementations.forEach((implementationInstance) => {
      // Get the namespace from the implementation instance
      const namespace = implementationInstance.getNamespace();

      // Get the prototype to access the methods defined on the class
      const prototype = Object.getPrototypeOf(implementationInstance);

      // Find all method names on the prototype, excluding constructor
      Object.getOwnPropertyNames(prototype)
        .filter((operationName) => operationName !== 'constructor' && typeof prototype[operationName] === 'function')
        .forEach((operationName) => {
          const operationFunction = implementationInstance[operationName];

          // Only register methods that have been decorated with @rpcMethod (i.e. RPC_METHOD_KEY is true)
          if (operationFunction && operationFunction[RPC_METHOD_KEY] === true) {
            // Create the full RPC method ID in format: namespace_operationName (e.g., eth_blockNumber)
            const rpcMethodName = `${namespace}_${operationName}`;

            // Bind the method to the implementation instance to preserve the 'this' context
            const boundMethod = operationFunction.bind(implementationInstance);

            // Preserve the original operation name by redefining the name property as after binding the name value is modified
            Object.defineProperty(boundMethod, 'name', {
              value: operationName,
            });

            // Get validation schema if it exists
            const validationSchema = operationFunction[RPC_PARAM_SCHEMA_KEY];
            if (validationSchema) {
              // Store validation schema with the method
              boundMethod[RPC_PARAM_SCHEMA_KEY] = validationSchema;
            }

            // Register the method with proper 'this' binding and original name
            registry.set(rpcMethodName, boundMethod);
          }
        });
    });

    return registry;
  }
}
