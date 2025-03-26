// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { rpcMethod } from '../../../../src/lib/decorators';
import { registerRpcMethods } from '../../../../src/lib/services/registryService/rpcMethodRegistryService';
import { RpcMethodRegistry, RpcNamespaceRegistry, RpcServiceImpl } from '../../../../src/lib/types';
chai.use(chaiAsPromised);

/**
 * Mock implementation of Web3Impl for testing purposes
 */
class MockWeb3Impl {
  static namespace = 'web3';

  // Method decorated with @rpcMethod
  // @ts-ignore: Decorator error in test environment
  @rpcMethod
  clientVersion() {
    return 'mock-version';
  }

  // Method without @rpcMethod
  nonRpcMethod() {
    return 'not-exposed';
  }

  getNamespace(): string {
    return MockWeb3Impl.namespace;
  }
}

/**
 * Mock implementation of NetImpl for testing purposes
 */
class MockNetImpl {
  static namespace = 'net';

  private chainId: string = '123';

  // Method decorated with @rpcMethod
  // @ts-ignore: Decorator error in test environment
  @rpcMethod
  listening() {
    return false;
  }

  // Method decorated with @rpcMethod
  // @ts-ignore: Decorator error in test environment
  @rpcMethod
  version() {
    return this.chainId;
  }

  getNamespace(): string {
    return MockNetImpl.namespace;
  }
}

/**
 * Mock implementation of DebugImpl for testing purposes
 */
class MockDebugImpl {
  static namespace = 'debug';

  // Method decorated with @rpcMethod
  // @ts-ignore: Decorator error in test environment
  @rpcMethod
  async traceTransaction(transactionId: string) {
    return { transaction: transactionId };
  }

  getNamespace(): string {
    return MockDebugImpl.namespace;
  }
}

describe('RpcMethodRegistryService', () => {
  // Test instances
  let mockWeb3: MockWeb3Impl;
  let mockNet: MockNetImpl;
  let mockDebug: MockDebugImpl;

  // Test helpers
  let rpcNamespaceRegistry: RpcNamespaceRegistry[];
  let registry: RpcMethodRegistry;

  beforeEach(() => {
    // Reset test instances before each test
    mockWeb3 = new MockWeb3Impl();
    mockNet = new MockNetImpl();
    mockDebug = new MockDebugImpl();

    // Cast our mock rpcNamespaceRegistry to the RpcImplementation type
    rpcNamespaceRegistry = [
      {
        namespace: 'web3',
        serviceImpl: mockWeb3 as unknown as RpcServiceImpl,
      },
      {
        namespace: 'net',
        serviceImpl: mockNet as unknown as RpcServiceImpl,
      },
      { namespace: 'debug', serviceImpl: mockDebug as unknown as RpcServiceImpl },
    ];
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('register', () => {
    it('should register decorated methods from all rpcNamespaceRegistry', () => {
      registry = registerRpcMethods(rpcNamespaceRegistry);

      // Should have the correct number of methods
      expect(registry.size).to.equal(4);

      // Should include all decorated methods
      expect(registry.has('web3_clientVersion')).to.be.true;
      expect(registry.has('net_listening')).to.be.true;
      expect(registry.has('net_version')).to.be.true;
      expect(registry.has('debug_traceTransaction')).to.be.true;
    });

    it('should not register methods without the RPC_METHOD_KEY', () => {
      registry = registerRpcMethods(rpcNamespaceRegistry);

      // Should not include non-decorated methods
      expect(registry.has('web3_nonRpcMethod')).to.be.false;
    });

    it('should return an empty map when no implementations are provided', () => {
      registry = registerRpcMethods([]);
      expect(registry.size).to.equal(0);
    });

    it('should correctly bind methods to their implementation instances', async () => {
      registry = registerRpcMethods(rpcNamespaceRegistry);

      // Get the methods from the registry
      const methods = {
        clientVersion: registry.get('web3_clientVersion'),
        listening: registry.get('net_listening'),
        version: registry.get('net_version'),
        traceTransaction: registry.get('debug_traceTransaction'),
      };

      // Methods should exist
      Object.values(methods).forEach((method) => {
        expect(method).to.exist;
      });

      // Methods should be bound to their instances
      expect(methods.clientVersion!()).to.equal('mock-version');
      expect(methods.listening!()).to.equal(false);
      expect(methods.version!()).to.equal('123');

      // Async method should work and be properly bound
      const traceResult = await methods.traceTransaction!('0x123');
      expect(traceResult).to.deep.equal({ transaction: '0x123' });
    });

    it('should register multiple methods from the same implementation', () => {
      registry = registerRpcMethods(rpcNamespaceRegistry.filter(({ namespace }) => namespace === 'net'));

      expect(registry.size).to.equal(2);
      expect(registry.has('net_listening')).to.be.true;
      expect(registry.has('net_version')).to.be.true;
    });

    it('should preserve `this` context in registered methods', () => {
      // Create a MockNetImpl with internal state
      const netWithState = new MockNetImpl();
      // Add a property using private access pattern
      (netWithState as any).chainId = '456';

      registry = registerRpcMethods([
        {
          namespace: 'net',
          serviceImpl: netWithState as unknown as RpcServiceImpl,
        },
      ]);

      // The version method should access the instance property
      const versionMethod = registry.get('net_version');
      expect(versionMethod!()).to.equal('456');
    });

    it('should preserve the original method name after binding', () => {
      registry = registerRpcMethods(rpcNamespaceRegistry);

      // Get the methods from the registry
      const clientVersionMethod = registry.get('web3_clientVersion');
      const listeningMethod = registry.get('net_listening');
      const versionMethod = registry.get('net_version');
      const traceTransactionMethod = registry.get('debug_traceTransaction');

      // Verify the method names are preserved
      expect(clientVersionMethod!.name).to.equal('clientVersion');
      expect(listeningMethod!.name).to.equal('listening');
      expect(versionMethod!.name).to.equal('version');
      expect(traceTransactionMethod!.name).to.equal('traceTransaction');
    });

    it('should verify that bound methods without name preservation would have different names', () => {
      // Create a simple function to test binding behavior without our custom name preservation
      const obj = {
        operationName() {
          return 'test';
        },
      };

      // Standard binding without name preservation
      const boundMethod = obj.operationName.bind(obj);

      // Bound methods typically have names like "bound methodName"
      expect(boundMethod.name).to.not.equal('operationName');
      expect(boundMethod.name.includes('bound')).to.be.true;

      // Our registry should preserve the original name
      registry = registerRpcMethods(rpcNamespaceRegistry);
      const registeredMethod = registry.get('web3_clientVersion');
      expect(registeredMethod!.name).to.equal('clientVersion');
    });
  });
});
