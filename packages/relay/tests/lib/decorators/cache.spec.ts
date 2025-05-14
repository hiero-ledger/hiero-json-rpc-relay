import { expect } from 'chai';
import sinon from 'sinon';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { CacheService } from '../../../dist/lib/services/cacheService/cacheService';
import { RequestDetails } from '../../../src/lib/types';
import { cache } from '../../../dist/lib/decorators';

describe('cache decorator', () => {
  let sandbox: sinon.SinonSandbox;
  let cacheService: sinon.SinonStubbedInstance<CacheService>;
  let configStub: sinon.SinonStub;

  const COMPUTED_RESULT = 'computed result';
  const CACHED_RESULT = 'cached result';
  const requestDetails = new RequestDetails({ requestId: '1', ipAddress: '127.0.0.1' });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    cacheService = {
      getAsync: sandbox.stub(),
      set: sandbox.stub()
    } as any;

    // default ttl
    configStub = sandbox.stub(ConfigService, 'get').returns(5644);
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createDecoratedMethod = (options = {}) => {
    class TestClass {
      @cache(cacheService as unknown as CacheService, options)
      async testMethod(arg1: any, arg2: any, requestDetails: RequestDetails) {
        return COMPUTED_RESULT;
      }
    }

    return new TestClass();
  };

  it('should return cached result if available', async () => {
    const instance = createDecoratedMethod();
    cacheService.getAsync.resolves(CACHED_RESULT);

    const result = await instance.testMethod('arg1', 'arg2', requestDetails);
    expect(result).to.equal(CACHED_RESULT);
    expect(cacheService.getAsync.calledOnce).to.be.true;
    expect(cacheService.set.notCalled).to.be.true;
  });

  it('should compute and cache result if not cached', async () => {
    const instance = createDecoratedMethod();
    cacheService.getAsync.resolves(null);

    const result = await instance.testMethod('arg1', 'arg2', requestDetails);
    expect(result).to.equal(COMPUTED_RESULT);
    expect(cacheService.getAsync.calledOnce).to.be.true;
    expect(cacheService.set.calledOnce).to.be.true;

    const args = cacheService.set.getCall(0).args;
    expect(args[1]).to.equal(COMPUTED_RESULT);
    expect(args[4]).to.equal(5644);
  });

  it('should not cache result if shouldSkipCachingForSingleParams returns true', async () => {
    const instance = createDecoratedMethod({
      skipParams: [{ index: '0', value: 'latest' }]
    });
    cacheService.getAsync.resolves(null);

    const result = await instance.testMethod('latest', 'another', requestDetails);
    expect(result).to.equal(COMPUTED_RESULT);
    expect(cacheService.set.notCalled).to.be.true;
  });

  it('should not cache result if shouldSkipCachingForNamedParams returns true', async () => {
    const instance = createDecoratedMethod({
      skipNamedParams: [{
        index: '0',
        fields: [{ name: 'fromBlock', value: 'latest|pending' }]
      }]
    });
    cacheService.getAsync.resolves(null);

    const result = await instance.testMethod({ fromBlock: 'pending' }, 'another', requestDetails);
    expect(result).to.equal(COMPUTED_RESULT);
    expect(cacheService.set.notCalled).to.be.true;
  });

  it('should use custom TTL if provided', async () => {
    const instance = createDecoratedMethod({ ttl: 555 });
    cacheService.getAsync.resolves(null);

    const result = await instance.testMethod('latest', 'another', requestDetails);
    expect(result).to.equal(COMPUTED_RESULT);
    expect(cacheService.set.calledOnce).to.be.true;
    expect(cacheService.set.getCall(0).args[4]).to.equal(555);
  });
});
