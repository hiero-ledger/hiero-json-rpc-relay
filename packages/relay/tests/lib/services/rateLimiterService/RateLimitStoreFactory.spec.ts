// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Logger, pino } from 'pino';
import { Counter, Registry } from 'prom-client';

import { LruRateLimitStore } from '../../../../src/lib/services/rateLimiterService/LruRateLimitStore';
import { RateLimitStoreFactory } from '../../../../src/lib/services/rateLimiterService/RateLimitStoreFactory';
import { RedisRateLimitStore } from '../../../../src/lib/services/rateLimiterService/RedisRateLimitStore';

chai.use(chaiAsPromised);

describe('RateLimitStoreFactory', () => {
  let logger: Logger;
  let registry: Registry;
  let rateLimitStoreFailureCounter: Counter;
  const testDuration = 5000;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    registry = new Registry();
    rateLimitStoreFailureCounter = new Counter({
      name: 'test_rate_limit_store_failure',
      help: 'Test counter for rate limit store failures',
      labelNames: ['store_type', 'method'],
      registers: [registry],
    });
  });

  describe('create', () => {
    it('should return LruRateLimitStore when redisClient is not provided', () => {
      const store = RateLimitStoreFactory.create(logger, testDuration);

      expect(store).to.be.instanceOf(LruRateLimitStore);
    });

    it('should return LruRateLimitStore when redisClient is undefined', () => {
      const store = RateLimitStoreFactory.create(logger, testDuration, rateLimitStoreFailureCounter, undefined);

      expect(store).to.be.instanceOf(LruRateLimitStore);
    });

    it('should return RedisRateLimitStore when redisClient is provided', () => {
      // Mock Redis client - just needs to be a truthy object for the factory logic
      const mockRedisClient = { eval: () => {} } as any;

      const store = RateLimitStoreFactory.create(logger, testDuration, rateLimitStoreFailureCounter, mockRedisClient);

      expect(store).to.be.instanceOf(RedisRateLimitStore);
    });

    it('should return LruRateLimitStore without failure counter', () => {
      const store = RateLimitStoreFactory.create(logger, testDuration);

      expect(store).to.be.instanceOf(LruRateLimitStore);
    });

    it('should return RedisRateLimitStore with failure counter', () => {
      const mockRedisClient = { eval: () => {} } as any;

      const store = RateLimitStoreFactory.create(logger, testDuration, rateLimitStoreFailureCounter, mockRedisClient);

      expect(store).to.be.instanceOf(RedisRateLimitStore);
    });

    it('should create different store instances on multiple calls', () => {
      const store1 = RateLimitStoreFactory.create(logger, testDuration);
      const store2 = RateLimitStoreFactory.create(logger, testDuration);

      expect(store1).to.not.equal(store2);
      expect(store1).to.be.instanceOf(LruRateLimitStore);
      expect(store2).to.be.instanceOf(LruRateLimitStore);
    });

    it('should create different Redis store instances on multiple calls', () => {
      const mockRedisClient = { eval: () => {} } as any;

      const store1 = RateLimitStoreFactory.create(logger, testDuration, rateLimitStoreFailureCounter, mockRedisClient);
      const store2 = RateLimitStoreFactory.create(logger, testDuration, rateLimitStoreFailureCounter, mockRedisClient);

      expect(store1).to.not.equal(store2);
      expect(store1).to.be.instanceOf(RedisRateLimitStore);
      expect(store2).to.be.instanceOf(RedisRateLimitStore);
    });
  });
});
