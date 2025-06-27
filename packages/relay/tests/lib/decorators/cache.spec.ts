// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import sinon from 'sinon';

import { __test__, cache } from '../../../src/lib/decorators';
import { CacheService } from '../../../src/lib/services/cacheService/cacheService';
import { RequestDetails } from '../../../src/lib/types';

describe('cache decorator', () => {
  let sandbox: sinon.SinonSandbox;
  let cacheService: sinon.SinonStubbedInstance<CacheService>;

  const CACHED_RESULT = 'cached result';
  const requestDetails = new RequestDetails({ requestId: '1', ipAddress: '127.0.0.1' });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    cacheService = {
      getAsync: sandbox.stub(),
      set: sandbox.stub(),
    } as any;
  });

  afterEach(() => {
    sandbox.restore();
  });

  const getComputedResult = (it1, it2, it3) => {
    return it1 + it2 + it3;
  };

  const createDecoratedMethod = (options = {}) => {
    class TestClass {
      @cache(cacheService as unknown as CacheService, options)
      async testMethod(arg1: any, arg2: any, requestDetails: RequestDetails) {
        return getComputedResult(arg1, arg2, requestDetails);
      }
    }

    return new TestClass();
  };

  describe('@cache', async () => {
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
      expect(result).to.equal(getComputedResult('arg1', 'arg2', requestDetails));
      expect(cacheService.getAsync.calledOnce).to.be.true;
      expect(cacheService.set.calledOnce).to.be.true;

      const args = cacheService.set.getCall(0).args;
      expect(args[1]).to.equal(getComputedResult('arg1', 'arg2', requestDetails));
      expect(args[4]).to.equal(ConfigService.get('CACHE_TTL'));
    });

    it('should not cache result if shouldSkipCachingForSingleParams returns true', async () => {
      const instance = createDecoratedMethod({
        skipParams: [{ index: '0', value: 'latest' }],
      });
      cacheService.getAsync.resolves(null);

      const result = await instance.testMethod('latest', 'another', requestDetails);
      expect(result).to.equal(getComputedResult('latest', 'another', requestDetails));
      expect(cacheService.set.notCalled).to.be.true;
    });

    it('should not cache result if shouldSkipCachingForNamedParams returns true', async () => {
      const instance = createDecoratedMethod({
        skipNamedParams: [
          {
            index: '0',
            fields: [{ name: 'fromBlock', value: 'latest|pending' }],
          },
        ],
      });
      cacheService.getAsync.resolves(null);

      const result = await instance.testMethod({ fromBlock: 'pending' }, 'another', requestDetails);
      expect(result).to.equal(getComputedResult({ fromBlock: 'pending' }, 'another', requestDetails));
      expect(cacheService.set.notCalled).to.be.true;
    });

    it('should use custom TTL if provided', async () => {
      const instance = createDecoratedMethod({ ttl: 555 });
      cacheService.getAsync.resolves(null);

      const result = await instance.testMethod('latest', 'another', requestDetails);
      expect(result).to.equal(getComputedResult('latest', 'another', requestDetails));
      expect(cacheService.set.calledOnce).to.be.true;
      expect(cacheService.set.getCall(0).args[4]).to.equal(555);
    });
  });

  describe('shouldSkipCachingForSingleParams', () => {
    it('should return false if no skip rules are provided', () => {
      const args = ['safe', 'latest'];
      const result = __test__.__private.shouldSkipCachingForSingleParams(args, []);
      expect(result).to.be.false;
    });

    it('should return false if argument exists but is not in skip values', () => {
      const args = ['latest', 'earliest'];
      const params = [
        { index: '0', value: 'pending' },
        { index: '1', value: 'safe|finalized' },
      ];
      const result = __test__.__private.shouldSkipCachingForSingleParams(args, params);
      expect(result).to.be.false;
    });

    it('should return true if a param at index matches any value in the pipe-separated list', () => {
      const args = ['earliest', 'safe'];
      const params = [{ index: '1', value: 'pending|safe' }];
      const result = __test__.__private.shouldSkipCachingForSingleParams(args, params);
      expect(result).to.be.true;
    });

    it('should return true if the argument at index is missing (do not cache optional parameters)', () => {
      const args = ['latest'];
      const params = [{ index: '1', value: 'pending|safe' }];
      const result = __test__.__private.shouldSkipCachingForSingleParams(args, params);
      expect(result).to.be.true;
    });

    it('should return true if the argument at index is explicitly undefined', () => {
      const args = ['finalized', undefined];
      const params = [{ index: '1', value: 'pending|safe' }];
      const result = __test__.__private.shouldSkipCachingForSingleParams(args, params);
      expect(result).to.be.true;
    });
  });

  describe('shouldSkipCachingForNamedParams', () => {
    it('should return false when no rules are provided', () => {
      const args = [{ fromBlock: 'safe' }];
      const result = __test__.__private.shouldSkipCachingForNamedParams(args, []);
      expect(result).to.be.false;
    });

    it('should return false if the field value does not match skip values', () => {
      const args = [{ fromBlock: 'confirmed' }];
      const params = [
        {
          index: '0',
          fields: [{ name: 'fromBlock', value: 'pending|safe' }],
        },
      ];
      const result = __test__.__private.shouldSkipCachingForNamedParams(args, params);
      expect(result).to.be.false;
    });

    it('should return false if none of the multiple fields match', () => {
      const args = [{ fromBlock: 'finalized', toBlock: 'earliest' }];
      const params = [
        {
          index: '0',
          fields: [
            { name: 'fromBlock', value: 'pending|safe' },
            { name: 'toBlock', value: 'latest' },
          ],
        },
      ];
      const result = __test__.__private.shouldSkipCachingForNamedParams(args, params);
      expect(result).to.be.false;
    });

    it('should return true if a field matches one of the skip values', () => {
      const args = [{ fromBlock: 'pending' }];
      const params = [
        {
          index: '0',
          fields: [{ name: 'fromBlock', value: 'pending|safe' }],
        },
      ];
      const result = __test__.__private.shouldSkipCachingForNamedParams(args, params);
      expect(result).to.be.true;
    });

    it('should return true if multiple fields are specified and one matches', () => {
      const args = [{ fromBlock: 'earliest', toBlock: 'latest' }];
      const params = [
        {
          index: '0',
          fields: [
            { name: 'fromBlock', value: 'pending|safe' },
            { name: 'toBlock', value: 'latest' },
          ],
        },
      ];
      const result = __test__.__private.shouldSkipCachingForNamedParams(args, params);
      expect(result).to.be.true;
    });
  });

  describe('generateCacheKey', () => {
    it('should return only the method name when args are empty', () => {
      const args = [];

      const result = __test__.__private.generateCacheKey('eth_getBalance', args);
      expect(result).to.equal('eth_getBalance');
    });

    it('should append primitive arguments to the cache key', () => {
      const args = ['0xabc', 'latest'];

      const result = __test__.__private.generateCacheKey('eth_getBalance', args);
      expect(result).to.equal('eth_getBalance_0xabc_latest');
    });

    it('should append object key-value pairs to the cache key', () => {
      const args = [{ fromBlock: 'earliest', toBlock: 5644 }];

      const result = __test__.__private.generateCacheKey('eth_getLogs', args);
      expect(result).to.equal('eth_getLogs_{"fromBlock":"earliest","toBlock":5644}');
    });

    it('should ignore arguments with constructor name "RequestDetails"', () => {
      const mockRequestDetails = new RequestDetails({ requestId: '1', ipAddress: '127.0.0.1' });
      const args = [mockRequestDetails, 'earliest'];

      const result = __test__.__private.generateCacheKey('eth_call', args);
      expect(result).to.equal('eth_call_earliest');
    });

    it('should not skip null or undefined args', () => {
      const args = [undefined, null, 'pending'];

      const result = __test__.__private.generateCacheKey('eth_call', args);
      expect(result).to.equal('eth_call_undefined_null_pending');
    });

    it('should process multiple arguments correctly', () => {
      const args = [{ fromBlock: '0xabc' }, 5644, 'safe'];

      const result = __test__.__private.generateCacheKey('eth_getLogs', args);
      expect(result).to.equal('eth_getLogs_{"fromBlock":"0xabc"}_5644_safe');
    });

    it('should work with mixed types including booleans and numbers', () => {
      const args = [true, 42, { fromBlock: 'safe' }];

      const result = __test__.__private.generateCacheKey('custom_method', args);
      expect(result).to.equal('custom_method_true_42_{"fromBlock":"safe"}');
    });

    it('should serialize nested objects using JSON.stringify', () => {
      const args = [
        {
          tracer: 'callTracer',
          tracerConfig: { onlyTopCall: true },
        },
      ];

      const result = __test__.__private.generateCacheKey('debug_traceTransaction', args);
      expect(result).to.equal('debug_traceTransaction_{"tracer":"callTracer","tracerConfig":{"onlyTopCall":true}}');
    });

    it('should differentiate between different nested object values', () => {
      const args1 = [
        {
          tracer: 'callTracer',
          tracerConfig: { onlyTopCall: true },
        },
      ];

      const args2 = [
        {
          tracer: 'callTracer',
          tracerConfig: { onlyTopCall: false },
        },
      ];

      const result1 = __test__.__private.generateCacheKey('debug_traceTransaction', args1);
      const result2 = __test__.__private.generateCacheKey('debug_traceTransaction', args2);

      expect(result1).to.equal('debug_traceTransaction_{"tracer":"callTracer","tracerConfig":{"onlyTopCall":true}}');
      expect(result2).to.equal('debug_traceTransaction_{"tracer":"callTracer","tracerConfig":{"onlyTopCall":false}}');
      expect(result1).to.not.equal(result2);
    });

    it('should handle nested objects with multiple properties', () => {
      const args = [
        {
          config: {
            timeout: 5000,
            retries: 3,
            options: { debug: true },
          },
        },
      ];

      const result = __test__.__private.generateCacheKey('test_method', args);
      expect(result).to.equal('test_method_{"config":{"timeout":5000,"retries":3,"options":{"debug":true}}}');
    });

    it('should handle nested arrays in objects', () => {
      const args = [
        {
          filter: {
            addresses: ['0x123', '0x456'],
            topics: [null, '0xabc'],
          },
        },
      ];

      const result = __test__.__private.generateCacheKey('eth_getLogs', args);
      expect(result).to.equal('eth_getLogs_{"filter":{"addresses":["0x123","0x456"],"topics":[null,"0xabc"]}}');
    });

    it('should handle deeply nested objects', () => {
      const args = [
        {
          level1: {
            level2: {
              level3: {
                value: 'deep',
              },
            },
          },
        },
      ];

      const result = __test__.__private.generateCacheKey('deep_method', args);
      expect(result).to.equal('deep_method_{"level1":{"level2":{"level3":{"value":"deep"}}}}');
    });
  });

  describe('extractRequestDetails', () => {
    it('should return the RequestDetails instance if found in args', () => {
      const requestDetails = new RequestDetails({ requestId: 'abc123', ipAddress: '127.0.0.1' });
      const args = [5644, requestDetails, 'other'];

      const result = __test__.__private.extractRequestDetails(args);
      expect(result.requestId).to.equal('abc123');
      expect(result.ipAddress).to.equal('127.0.0.1');
    });

    it('should return a new default RequestDetails if not found', () => {
      const args = [5644, { fromBlock: 'pending' }, 'value'];

      const result = __test__.__private.extractRequestDetails(args);
      expect(result.requestId).to.equal('');
      expect(result.ipAddress).to.equal('');
    });

    it('should return new RequestDetails when args is empty', () => {
      const args = [];

      const result = __test__.__private.extractRequestDetails(args);
      expect(result.requestId).to.equal('');
      expect(result.ipAddress).to.equal('');
    });

    it('should return the first RequestDetails instance if multiple are present', () => {
      const rd1 = new RequestDetails({ requestId: 'first', ipAddress: '1.1.1.1' });
      const rd2 = new RequestDetails({ requestId: 'second', ipAddress: '2.2.2.2' });
      const args = [rd1, rd2];

      const result = __test__.__private.extractRequestDetails(args);
      expect(result).to.equal(rd1);
    });

    it('should handle null or undefined values in args', () => {
      const args = [undefined, null, 5644];

      const result = __test__.__private.extractRequestDetails(args);
      expect(result.requestId).to.equal('');
      expect(result.ipAddress).to.equal('');
    });
  });
});
