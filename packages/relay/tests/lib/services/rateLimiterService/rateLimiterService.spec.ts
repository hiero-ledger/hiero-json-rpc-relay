// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Logger, pino } from 'pino';
import { Registry } from 'prom-client';
import { RedisClientType } from 'redis';
import * as sinon from 'sinon';

import { LruRateLimitStore } from '../../../../src/lib/services/rateLimiterService/LruRateLimitStore';
import { IPRateLimiterService } from '../../../../src/lib/services/rateLimiterService/rateLimiterService';
import { RedisRateLimitStore } from '../../../../src/lib/services/rateLimiterService/RedisRateLimitStore';
import { RateLimitKey, RateLimitStore } from '../../../../src/lib/types/rateLimiter';
import { RequestDetails } from '../../../../src/lib/types/RequestDetails';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../../helpers';

describe('IPRateLimiterService Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let registry: Registry;
  let rateLimiterService: IPRateLimiterService;
  let mockStore: sinon.SinonStubbedInstance<RateLimitStore>;
  let mockRedisClient: sinon.SinonStubbedInstance<RedisClientType>;

  const duration = 1000;
  const testIp = '127.0.0.1';
  const testMethod = 'eth_chainId';
  const testLimit = 5;
  const requestId = 'test-request-id';
  const requestDetails: RequestDetails = { requestId } as RequestDetails;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    registry = new Registry();

    // Create a mock store for tests
    mockStore = {
      incrementAndCheck: sinon.stub().resolves(false),
    } as any;

    // Create a mock Redis client for tests that need it
    mockRedisClient = {
      eval: sinon.stub(),
    } as any;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor Tests', () => {
    it('should accept a store and initialize correctly', () => {
      const lruStore = new LruRateLimitStore(duration);
      rateLimiterService = new IPRateLimiterService(lruStore, registry);

      expect(rateLimiterService.rateLimitStore).to.equal(lruStore);
    });

    it('should work with LRU store', () => {
      const lruStore = new LruRateLimitStore(duration);
      rateLimiterService = new IPRateLimiterService(lruStore, registry);

      expect(rateLimiterService.rateLimitStore).to.be.instanceof(LruRateLimitStore);
    });

    it('should work with Redis store', () => {
      const redisStore = new RedisRateLimitStore(mockRedisClient as unknown as RedisClientType, logger, duration);
      rateLimiterService = new IPRateLimiterService(redisStore, registry);

      expect(rateLimiterService.rateLimitStore).to.be.instanceof(RedisRateLimitStore);
    });
  });

  describe('shouldRateLimit Method Tests', () => {
    withOverriddenEnvsInMochaTest({ RATE_LIMIT_DISABLED: true }, () => {
      it('should return false when RATE_LIMIT_DISABLED is true', async () => {
        rateLimiterService = new IPRateLimiterService(mockStore, registry);

        const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
        expect(result).to.be.false;
      });
    });

    describe('Rate Limiting Logic', () => {
      overrideEnvsInMochaDescribe({
        RATE_LIMIT_DISABLED: false,
      });

      beforeEach(() => {
        rateLimiterService = new IPRateLimiterService(mockStore, registry);
      });

      it('should return false when within rate limits', async () => {
        mockStore.incrementAndCheck.resolves(false);

        const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);

        expect(result).to.be.false;
        expect(mockStore.incrementAndCheck.calledOnce).to.be.true;
        expect(mockStore.incrementAndCheck.getCall(0).args[0]).to.be.instanceOf(RateLimitKey);
        expect(mockStore.incrementAndCheck.getCall(0).args[0].toString()).to.equal(`ratelimit:${testIp}:${testMethod}`);
        expect(mockStore.incrementAndCheck.getCall(0).args[1]).to.equal(testLimit);
        expect(mockStore.incrementAndCheck.getCall(0).args[2]).to.equal(requestDetails);
      });

      it('should return true when rate limit is exceeded', async () => {
        mockStore.incrementAndCheck.resolves(true);

        const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);

        expect(result).to.be.true;
        expect(mockStore.incrementAndCheck.calledOnce).to.be.true;
      });

      it('should increment metrics counter when rate limit is exceeded', async () => {
        mockStore.incrementAndCheck.resolves(true);
        const counterSpy = sinon.spy(rateLimiterService['ipRateLimitCounter'], 'inc');

        await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);

        expect(counterSpy.calledOnce).to.be.true;
      });

      it('should handle different IPs independently', async () => {
        mockStore.incrementAndCheck.resolves(false);

        await rateLimiterService.shouldRateLimit('192.168.1.1', testMethod, testLimit, requestDetails);
        await rateLimiterService.shouldRateLimit('192.168.1.2', testMethod, testLimit, requestDetails);

        expect(mockStore.incrementAndCheck.calledTwice).to.be.true;
        expect(mockStore.incrementAndCheck.getCall(0).args[0].toString()).to.equal('ratelimit:192.168.1.1:eth_chainId');
        expect(mockStore.incrementAndCheck.getCall(1).args[0].toString()).to.equal('ratelimit:192.168.1.2:eth_chainId');
      });

      it('should handle different methods independently', async () => {
        mockStore.incrementAndCheck.resolves(false);

        await rateLimiterService.shouldRateLimit(testIp, 'eth_chainId', testLimit, requestDetails);
        await rateLimiterService.shouldRateLimit(testIp, 'eth_gasPrice', testLimit, requestDetails);

        expect(mockStore.incrementAndCheck.calledTwice).to.be.true;
        expect(mockStore.incrementAndCheck.getCall(0).args[0].toString()).to.equal('ratelimit:127.0.0.1:eth_chainId');
        expect(mockStore.incrementAndCheck.getCall(1).args[0].toString()).to.equal('ratelimit:127.0.0.1:eth_gasPrice');
      });
    });
  });

  describe('LRU Store Integration Tests', () => {
    overrideEnvsInMochaDescribe({
      RATE_LIMIT_DISABLED: false,
    });

    let lruStore: LruRateLimitStore;

    beforeEach(() => {
      lruStore = new LruRateLimitStore(duration);
      rateLimiterService = new IPRateLimiterService(lruStore, registry);
    });

    it('should not rate limit when within limits using LRU store', async () => {
      const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      expect(result).to.be.false;
    });

    it('should rate limit when exceeding limits using LRU store', async () => {
      // Make requests up to the limit
      for (let i = 0; i < testLimit; i++) {
        const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
        expect(result).to.be.false;
      }

      // Next request should be rate limited
      const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      expect(result).to.be.true;
    });

    it('should reset rate limit after duration using LRU store', async function () {
      this.timeout(3000);

      // Exhaust the rate limit
      for (let i = 0; i <= testLimit; i++) {
        await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      }

      // Wait for reset
      await new Promise((resolve) => setTimeout(resolve, duration + 100));

      // Should not be rate limited after reset
      const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      expect(result).to.be.false;
    });

    it('LRU store should handle any valid key format', async () => {
      const store = new LruRateLimitStore(duration);
      const validKey = new RateLimitKey('192.168.1.1', 'eth_chainId');
      const result = await store.incrementAndCheck(validKey, 5);
      expect(result).to.be.false; // Should not be rate limited on first request
    });
  });

  describe('Redis Store Integration Tests', () => {
    it('should work with Redis store', () => {
      const redisStore = new RedisRateLimitStore(mockRedisClient as unknown as RedisClientType, logger, duration);
      rateLimiterService = new IPRateLimiterService(redisStore, registry);

      expect(rateLimiterService.rateLimitStore).to.be.instanceof(RedisRateLimitStore);
    });

    it('should handle Redis operation failures gracefully (fail-open behavior)', async () => {
      // Create a mock that fails on eval
      const failingMockClient = {
        eval: sinon.stub().rejects(new Error('Redis eval failed')),
      } as unknown as RedisClientType;

      const redisStore = new RedisRateLimitStore(failingMockClient, logger, duration);
      rateLimiterService = new IPRateLimiterService(redisStore, registry);

      // Should not rate limit when Redis operations fail (fail-open behavior)
      const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      expect(result).to.be.false;
    });
  });

  // Ensure store.incrementAndCheck is not called when rate limiting is disabled
  withOverriddenEnvsInMochaTest({ RATE_LIMIT_DISABLED: true }, () => {
    it('should not call store.incrementAndCheck when rate limit is disabled', async () => {
      rateLimiterService = new IPRateLimiterService(mockStore, registry);
      const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      expect(result).to.be.false;
      expect(mockStore.incrementAndCheck.notCalled).to.be.true;
    });
  });
});
