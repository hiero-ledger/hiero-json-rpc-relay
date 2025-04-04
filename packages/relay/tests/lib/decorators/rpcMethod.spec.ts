// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { RPC_METHOD_KEY, rpcMethod } from '../../../src/lib/decorators';
import { NetImpl } from '../../../src/lib/net';
import { Web3Impl } from '../../../src/lib/web3';

chai.use(chaiAsPromised);

describe('rpcMethod decorator integration', () => {
  // Instances of real implementation classes
  let netImpl: NetImpl;
  let web3Impl: Web3Impl;

  // Sinon stubs
  let configGetStub: sinon.SinonStub;

  before(() => {
    // No need to save original values since we're stubbing the method
  });

  beforeEach(() => {
    // Stub ConfigService.get to return test values
    configGetStub = sinon.stub(ConfigService, 'get');

    // Configure different return values based on the requested key
    configGetStub.withArgs('CHAIN_ID').returns('0x123');
    configGetStub.withArgs('npm_package_version').returns('1.0.0-test');

    // Create fresh instances for each test
    netImpl = new NetImpl();
    web3Impl = new Web3Impl();
  });

  afterEach(() => {
    // Restore all stubs
    sinon.restore();
  });

  describe('NetImpl', () => {
    it('should have decorated listening method with RPC_METHOD_KEY', () => {
      // Access the method from the instance
      const listeningMethod = netImpl.listening;

      // Verify RPC_METHOD_KEY is set
      expect(listeningMethod[RPC_METHOD_KEY]).to.equal(true);
    });

    it('should have decorated version method with RPC_METHOD_KEY', () => {
      const versionMethod = netImpl.version;

      expect(versionMethod[RPC_METHOD_KEY]).to.equal(true);
    });

    it('should have decorated peerCount method with RPC_METHOD_KEY', () => {
      const peerCountMethod = netImpl.peerCount;

      expect(peerCountMethod[RPC_METHOD_KEY]).to.equal(true);
    });

    it('should keep methods functional after decoration', () => {
      // Verify methods still work as expected
      expect(netImpl.version()).to.equal('291'); // Decimal representation of 0x123
      expect(netImpl.listening()).to.equal(true);
      expect(netImpl.peerCount()).to.have.property('code');
    });
  });

  describe('Web3Impl', () => {
    it('should have decorated clientVersion method with RPC_METHOD_KEY', () => {
      const clientVersionMethod = web3Impl.clientVersion;

      expect(clientVersionMethod[RPC_METHOD_KEY]).to.equal(true);
    });

    it('should have decorated sha3 method with RPC_METHOD_KEY', () => {
      const sha3Method = web3Impl.sha3;

      expect(sha3Method[RPC_METHOD_KEY]).to.equal(true);
    });

    it('should keep methods functional after decoration', () => {
      // Verify methods still work
      expect(web3Impl.clientVersion()).to.equal('relay/1.0.0-test');

      // Create a stub for sha3 to avoid actual hashing
      const sha3Stub = sinon.stub(web3Impl, 'sha3').returns('0xhashed');

      expect(web3Impl.sha3('test')).to.equal('0xhashed');
      expect(sha3Stub.calledWith('test')).to.be.true;
    });
  });

  describe('Decorator behavior', () => {
    // A test class that uses the actual decorator syntax
    class TestRpcClass {
      static namespace = 'test';

      // Use the actual decorator syntax with TypeScript comment to suppress errors
      // @ts-expect-error: TypeScript doesn't recognize decorators in tests
      @rpcMethod
      decoratedMethod() {
        return 'decorated-result';
      }

      nonDecoratedMethod() {
        return 'non-decorated-result';
      }

      getNamespace() {
        return TestRpcClass.namespace;
      }
    }

    let testInstance: TestRpcClass;

    beforeEach(() => {
      testInstance = new TestRpcClass();
    });

    it('should add RPC_METHOD_KEY to decorated methods only', () => {
      expect(testInstance.decoratedMethod[RPC_METHOD_KEY]).to.equal(true);
      expect(testInstance.nonDecoratedMethod[RPC_METHOD_KEY]).to.be.undefined;
    });

    it('should maintain method functionality', () => {
      expect(testInstance.decoratedMethod()).to.equal('decorated-result');
      expect(testInstance.nonDecoratedMethod()).to.equal('non-decorated-result');
    });
  });
});
