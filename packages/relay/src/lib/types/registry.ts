// SPDX-License-Identifier: Apache-2.0

import { DebugImpl } from '../debug';
import { EthImpl } from '../eth';
import { NetImpl } from '../net';
import { Web3Impl } from '../web3';

/**
 * Type for supported service implementations that contain RPC methods
 */
export type RpcServiceImpl = EthImpl | NetImpl | Web3Impl | DebugImpl;

/**
 * Type for supported namespaces
 */
export type RpcNamespace = 'eth' | 'net' | 'web3' | 'debug';

/**
 * Type for the registry mapping of namespaces to their service implementations
 */
export type RpcNamespaceRegistry = {
  namespace: RpcNamespace;
  serviceImpl: RpcServiceImpl;
};

/**
 * Represents a method handler function registered for remote invocation
 * This type is deliberately flexible to accommodate various method signatures:
 * - Methods with no parameters
 * - Methods with only regular parameters
 * - Methods with RequestDetails (which may not always be the last parameter)
 * - Methods with varying return types
 */
export type OperationHandler = (...args: any[]) => any;

/**
 * Type for the registry mapping of method names to their handler implementations
 */
export type RpcMethodRegistry = Map<string, OperationHandler>;
