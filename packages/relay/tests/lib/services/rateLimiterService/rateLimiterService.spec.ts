// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Logger, pino } from 'pino';
import { Registry } from 'prom-client';
import * as redis from 'redis';
import * as sinon from 'sinon';

import { LruRateLimitStore } from '../../../../src/lib/services/rateLimiterService/LruRateLimitStore';
import { IPRateLimiterService } from '../../../../src/lib/services/rateLimiterService/rateLimiterService';
import { RedisRateLimitStore } from '../../../../src/lib/services/rateLimiterService/RedisRateLimitStore';
import { RateLimitKey } from '../../../../src/lib/types/rateLimiter';
import { RequestDetails } from '../../../../src/lib/types/RequestDetails';
import { createMockRedisClient, overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../../helpers';

describe('IPRateLimiterService Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let registry: Registry;
  let rateLimiterService: IPRateLimiterService;

  const duration = 1000;
  const testIp = '127.0.0.1';
  const testMethod = 'eth_chainId';
  const testLimit = 5;
  const requestId = 'test-request-id';
  const requestDetails: RequestDetails = { requestId } as RequestDetails;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    registry = new Registry();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor Tests', () => {
    describe('Store Type Determination', () => {
      overrideEnvsInMochaDescribe({
        IP_RATE_LIMIT_STORE: undefined,
        REDIS_ENABLED: false,
        RATE_LIMIT_DISABLED: false,
      });

      it('should use LRU store when REDIS_ENABLED is false and no IP_RATE_LIMIT_STORE is set', () => {
        rateLimiterService = new IPRateLimiterService(logger, registry, duration);

        expect(rateLimiterService['store']).to.be.instanceof(LruRateLimitStore);
      });

      withOverriddenEnvsInMochaTest(
        { IP_RATE_LIMIT_STORE: undefined, REDIS_ENABLED: true, RATE_LIMIT_DISABLED: false },
        () => {
          it('should use Redis store when REDIS_ENABLED is true', () => {
            rateLimiterService = new IPRateLimiterService(logger, registry, duration);

            expect(rateLimiterService['store']).to.be.instanceof(RedisRateLimitStore);
          });
        },
      );

      withOverriddenEnvsInMochaTest(
        { IP_RATE_LIMIT_STORE: 'REDIS', REDIS_ENABLED: false, RATE_LIMIT_DISABLED: false },
        () => {
          it('should use configured store type when IP_RATE_LIMIT_STORE is set to REDIS', () => {
            rateLimiterService = new IPRateLimiterService(logger, registry, duration);

            expect(rateLimiterService['store']).to.be.instanceof(RedisRateLimitStore);
          });
        },
      );

      withOverriddenEnvsInMochaTest(
        { IP_RATE_LIMIT_STORE: 'LRU', REDIS_ENABLED: true, RATE_LIMIT_DISABLED: false },
        () => {
          it('should use configured store type when IP_RATE_LIMIT_STORE is set to LRU', () => {
            rateLimiterService = new IPRateLimiterService(logger, registry, duration);

            expect(rateLimiterService['store']).to.be.instanceof(LruRateLimitStore);
          });
        },
      );

      withOverriddenEnvsInMochaTest(
        { IP_RATE_LIMIT_STORE: 'INVALID_STORE', REDIS_ENABLED: false, RATE_LIMIT_DISABLED: false },
        () => {
          it('should throw error when IP_RATE_LIMIT_STORE is invalid', () => {
            expect(() => new IPRateLimiterService(logger, registry, duration)).to.throw(
              'Unsupported IP_RATE_LIMIT_STORE value: "INVALID_STORE". Supported values are: REDIS, LRU',
            );
          });
        },
      );
    });

    describe('Store Creation', () => {
      withOverriddenEnvsInMochaTest({ IP_RATE_LIMIT_STORE: 'REDIS' }, () => {
        it('should create Redis store when configured', () => {
          rateLimiterService = new IPRateLimiterService(logger, registry, duration);

          expect(rateLimiterService['store']).to.be.instanceof(RedisRateLimitStore);
        });
      });
    });
  });

  describe('shouldRateLimit Method Tests', () => {
    withOverriddenEnvsInMochaTest(
      { RATE_LIMIT_DISABLED: true, IP_RATE_LIMIT_STORE: undefined, REDIS_ENABLED: false },
      () => {
        it('should return false when RATE_LIMIT_DISABLED is true', async () => {
          rateLimiterService = new IPRateLimiterService(logger, registry, duration);

          const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
          expect(result).to.be.false;
        });
      },
    );

    describe('Rate Limiting Logic', () => {
      overrideEnvsInMochaDescribe({
        RATE_LIMIT_DISABLED: false,
        IP_RATE_LIMIT_STORE: undefined,
        REDIS_ENABLED: false,
      });

      beforeEach(() => {
        rateLimiterService = new IPRateLimiterService(logger, registry, duration);
      });

      it('should return false when within rate limits', async () => {
        const storeStub = sinon.stub(rateLimiterService['store'], 'incrementAndCheck').resolves(false);

        const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);

        expect(result).to.be.false;
        expect(storeStub.calledOnce).to.be.true;
        expect(storeStub.getCall(0).args[0]).to.be.instanceOf(RateLimitKey);
        expect(storeStub.getCall(0).args[0].toString()).to.equal(`ratelimit:${testIp}:${testMethod}`);
        expect(storeStub.getCall(0).args[1]).to.equal(testLimit);
        expect(storeStub.getCall(0).args[2]).to.equal(requestDetails);
      });

      it('should return true when rate limit is exceeded', async () => {
        const storeStub = sinon.stub(rateLimiterService['store'], 'incrementAndCheck').resolves(true);

        const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);

        expect(result).to.be.true;
        expect(storeStub.calledOnce).to.be.true;
      });

      it('should increment metrics counter when rate limit is exceeded', async () => {
        sinon.stub(rateLimiterService['store'], 'incrementAndCheck').resolves(true);
        const counterSpy = sinon.spy(rateLimiterService['ipRateLimitCounter'], 'inc');

        await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);

        expect(counterSpy.calledOnce).to.be.true;
      });

      it('should handle different IPs independently', async () => {
        const storeStub = sinon.stub(rateLimiterService['store'], 'incrementAndCheck').resolves(false);

        await rateLimiterService.shouldRateLimit('192.168.1.1', testMethod, testLimit, requestDetails);
        await rateLimiterService.shouldRateLimit('192.168.1.2', testMethod, testLimit, requestDetails);

        expect(storeStub.calledTwice).to.be.true;
        expect(storeStub.getCall(0).args[0].toString()).to.equal('ratelimit:192.168.1.1:eth_chainId');
        expect(storeStub.getCall(1).args[0].toString()).to.equal('ratelimit:192.168.1.2:eth_chainId');
      });

      it('should handle different methods independently', async () => {
        const storeStub = sinon.stub(rateLimiterService['store'], 'incrementAndCheck').resolves(false);

        await rateLimiterService.shouldRateLimit(testIp, 'eth_chainId', testLimit, requestDetails);
        await rateLimiterService.shouldRateLimit(testIp, 'eth_gasPrice', testLimit, requestDetails);

        expect(storeStub.calledTwice).to.be.true;
        expect(storeStub.getCall(0).args[0].toString()).to.equal('ratelimit:127.0.0.1:eth_chainId');
        expect(storeStub.getCall(1).args[0].toString()).to.equal('ratelimit:127.0.0.1:eth_gasPrice');
      });
    });
  });

  describe('LRU Store Integration Tests', () => {
    overrideEnvsInMochaDescribe({
      RATE_LIMIT_DISABLED: false,
      IP_RATE_LIMIT_STORE: 'LRU',
      REDIS_ENABLED: false,
    });

    beforeEach(() => {
      rateLimiterService = new IPRateLimiterService(logger, registry, duration);
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
    overrideEnvsInMochaDescribe({
      RATE_LIMIT_DISABLED: false,
      IP_RATE_LIMIT_STORE: 'REDIS',
      REDIS_ENABLED: true,
    });

    it('should use Redis store when configured', () => {
      rateLimiterService = new IPRateLimiterService(logger, registry, duration);

      expect(rateLimiterService['store']).to.be.instanceof(RedisRateLimitStore);
    });

    it('should handle Redis connection failures gracefully (fail-open behavior)', async () => {
      const mockRedisClient = createMockRedisClient({ connectRejects: true });
      const createClientStub = sinon.stub().returns(mockRedisClient);
      sinon.replace(redis, 'createClient', createClientStub);

      rateLimiterService = new IPRateLimiterService(logger, registry, duration);

      // Wait for connection promise to resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not rate limit when Redis is unavailable (fail-open behavior)
      const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      expect(result).to.be.false;
    });

    it('should handle Redis operation failures gracefully (fail-open behavior)', async () => {
      const mockRedisClient = createMockRedisClient({ evalRejects: true });
      const createClientStub = sinon.stub().returns(mockRedisClient);
      sinon.replace(redis, 'createClient', createClientStub);

      rateLimiterService = new IPRateLimiterService(logger, registry, duration);

      // Should not rate limit when Redis operations fail (fail-open behavior)
      const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
      expect(result).to.be.false;
    });
  });

  describe('Configuration Edge Cases', () => {
    withOverriddenEnvsInMochaTest({ IP_RATE_LIMIT_STORE: '  REDIS  ', REDIS_ENABLED: false }, () => {
      it('should handle whitespace in IP_RATE_LIMIT_STORE config', () => {
        rateLimiterService = new IPRateLimiterService(logger, registry, duration);

        expect(rateLimiterService['store']).to.be.instanceof(RedisRateLimitStore);
      });
    });

    withOverriddenEnvsInMochaTest({ IP_RATE_LIMIT_STORE: 'lru', REDIS_ENABLED: true }, () => {
      it('should handle lowercase IP_RATE_LIMIT_STORE config', () => {
        rateLimiterService = new IPRateLimiterService(logger, registry, duration);

        expect(rateLimiterService['store']).to.be.instanceof(LruRateLimitStore);
      });
    });

    withOverriddenEnvsInMochaTest({ IP_RATE_LIMIT_STORE: '', REDIS_ENABLED: false }, () => {
      it('should throw error for empty string IP_RATE_LIMIT_STORE config', () => {
        expect(() => new IPRateLimiterService(logger, registry, duration)).to.throw(
          'Unsupported IP_RATE_LIMIT_STORE value: "". Supported values are: REDIS, LRU',
        );
      });
    });
  });

  // Ensure store.incrementAndCheck is not called when rate limiting is disabled
  withOverriddenEnvsInMochaTest(
    { RATE_LIMIT_DISABLED: true, IP_RATE_LIMIT_STORE: undefined, REDIS_ENABLED: false },
    () => {
      it('should not call store.incrementAndCheck when rate limit is disabled', async () => {
        rateLimiterService = new IPRateLimiterService(logger, registry, duration);
        const stub = sinon.stub(rateLimiterService['store'], 'incrementAndCheck');
        const result = await rateLimiterService.shouldRateLimit(testIp, testMethod, testLimit, requestDetails);
        expect(result).to.be.false;
        expect(stub.notCalled).to.be.true;
      });
    },
  );
});
