// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { type Logger, pino } from 'pino';
import { Counter, Registry } from 'prom-client';
import { createClient, type RedisClientType } from 'redis';
import * as sinon from 'sinon';

import { RedisRateLimitStore } from '../../../../../src/relay/lib/services/rateLimiterService/RedisRateLimitStore';
import { RateLimitKey } from '../../../../../src/relay/lib/types/rateLimiter';
import { useInMemoryRedisServer } from '../../../helpers';

describe('RedisRateLimitStore Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let registry: Registry;
  let mockRedisClient: sinon.SinonStubbedInstance<RedisClientType>;
  let rateLimitStoreFailureCounter: Counter;

  const testDuration = 5000;
  const testKey = new RateLimitKey('127.0.0.1', 'eth_chainId');
  const testLimit = 5;

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    registry = new Registry();
    rateLimitStoreFailureCounter = new Counter({
      name: 'test_rate_limit_store_failure',
      help: 'Test counter for rate limit store failures',
      labelNames: ['store_type', 'method'],
      registers: [registry],
    });

    // Create a mock Redis client (pre-connected, as expected by the new pattern)
    mockRedisClient = {
      eval: sinon.stub(),
    } as any;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor Tests', () => {
    it('should create RedisRateLimitStore with injected Redis client', () => {
      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        testDuration,
        rateLimitStoreFailureCounter,
      );

      expect(store).to.be.instanceOf(RedisRateLimitStore);
    });

    it('should create RedisRateLimitStore without failure counter', () => {
      const store = new RedisRateLimitStore(mockRedisClient as unknown as RedisClientType, logger, testDuration);

      expect(store).to.be.instanceOf(RedisRateLimitStore);
    });
  });

  describe('incrementAndCheck Tests', () => {
    it('should successfully increment and check rate limit', async () => {
      mockRedisClient.eval.resolves(0); // Not rate limited

      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        testDuration,
        rateLimitStoreFailureCounter,
      );

      const result = await store.incrementAndCheck(testKey, testLimit);

      expect(result).to.be.false;
      expect(mockRedisClient.eval.calledOnce).to.be.true;

      const evalCall = mockRedisClient.eval.getCall(0);
      const evalOptions = evalCall.args[1] as { keys: string[]; arguments: string[] };
      expect(evalOptions.keys).to.deep.equal([testKey.toString()]);
      expect(evalOptions.arguments).to.deep.equal([String(testLimit), String(Math.ceil(testDuration / 1000))]);
    });

    it('should return true when rate limit is exceeded', async () => {
      mockRedisClient.eval.resolves(1); // Rate limited

      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        testDuration,
        rateLimitStoreFailureCounter,
      );

      const result = await store.incrementAndCheck(testKey, testLimit);

      expect(result).to.be.true;
    });

    it('should handle Redis operation failure and fail open', async () => {
      const redisError = new Error('Redis operation failed');
      mockRedisClient.eval.rejects(redisError);

      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        testDuration,
        rateLimitStoreFailureCounter,
      );

      const result = await store.incrementAndCheck(testKey, testLimit);

      expect(result).to.be.false; // Fail open
    });

    it('should increment failure counter when Redis operation fails', async () => {
      const redisError = new Error('Redis operation failed');
      mockRedisClient.eval.rejects(redisError);

      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        testDuration,
        rateLimitStoreFailureCounter,
      );

      const counterSpy = sinon.spy(rateLimitStoreFailureCounter, 'inc');

      await store.incrementAndCheck(testKey, testLimit);

      expect(counterSpy.calledOnce).to.be.true;
    });

    it('should handle Redis operation failure without failure counter', async () => {
      const redisError = new Error('Redis operation failed');
      mockRedisClient.eval.rejects(redisError);

      const store = new RedisRateLimitStore(mockRedisClient as unknown as RedisClientType, logger, testDuration); // No failure counter

      const result = await store.incrementAndCheck(testKey, testLimit);

      expect(result).to.be.false; // Should still fail open
    });

    it('should handle non-Error object in catch block', async () => {
      const stringError = 'String error';
      mockRedisClient.eval.rejects(stringError);

      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        testDuration,
        rateLimitStoreFailureCounter,
      );

      const result = await store.incrementAndCheck(testKey, testLimit);

      expect(result).to.be.false; // Should still fail open
    });

    it('should log error with request details when Redis operation fails', async () => {
      const redisError = new Error('Redis operation failed');
      mockRedisClient.eval.rejects(redisError);

      const testLogger = pino({ level: 'error' });
      // Stub child to return the same logger instance so we can spy on it
      sinon.stub(testLogger, 'child').returns(testLogger);
      const loggerSpy = sinon.spy(testLogger, 'error');

      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        testLogger,
        testDuration,
        rateLimitStoreFailureCounter,
      );

      await store.incrementAndCheck(testKey, testLimit);

      expect(loggerSpy.calledOnce).to.be.true;
    });

    it('should use correct TTL in seconds', async () => {
      mockRedisClient.eval.resolves(0);

      const durationMs = 60000; // 60 seconds
      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        durationMs,
        rateLimitStoreFailureCounter,
      );

      await store.incrementAndCheck(testKey, testLimit);

      const evalCall = mockRedisClient.eval.getCall(0);
      const evalOptions = evalCall.args[1] as { keys: string[]; arguments: string[] };
      expect(evalOptions.arguments[1]).to.equal('60'); // TTL in seconds
    });

    it('should ceil TTL when duration is not evenly divisible by 1000', async () => {
      mockRedisClient.eval.resolves(0);

      const durationMs = 1500; // 1.5 seconds - should ceil to 2
      const store = new RedisRateLimitStore(
        mockRedisClient as unknown as RedisClientType,
        logger,
        durationMs,
        rateLimitStoreFailureCounter,
      );

      await store.incrementAndCheck(testKey, testLimit);

      const evalCall = mockRedisClient.eval.getCall(0);
      const evalOptions = evalCall.args[1] as { keys: string[]; arguments: string[] };
      expect(evalOptions.arguments[1]).to.equal('2'); // TTL ceiled to 2 seconds
    });
  });
});

describe('RedisRateLimitStore Real Redis Test Suite', function () {
  this.timeout(20000);

  const logger = pino({ level: 'silent' });
  const duration = 1000;
  const port = 6386;

  let redisClient: RedisClientType;
  let store: RedisRateLimitStore;
  let keyCounter = 0;

  const uniqueKey = () => new RateLimitKey(`127.0.0.${++keyCounter}`, 'eth_chainId');

  after(() => {
    redisClient?.destroy();
  });

  useInMemoryRedisServer(logger, port);

  before(async () => {
    redisClient = createClient({ url: `redis://127.0.0.1:${port}` }) as RedisClientType;
    await redisClient.connect();
    store = new RedisRateLimitStore(redisClient, logger, duration);
  });

  it('should allow requests up to the limit', async () => {
    const key = uniqueKey();

    for (let i = 0; i < 5; i++) {
      expect(await store.incrementAndCheck(key, 5)).to.be.false;
    }
  });

  it('should block the request that exceeds the limit', async () => {
    const key = uniqueKey();

    for (let i = 0; i < 5; i++) {
      await store.incrementAndCheck(key, 5);
    }

    expect(await store.incrementAndCheck(key, 5)).to.be.true;
  });

  it('should keep blocking once the limit is exceeded', async () => {
    const key = uniqueKey();

    for (let i = 0; i < 6; i++) {
      await store.incrementAndCheck(key, 5);
    }

    expect(await store.incrementAndCheck(key, 5)).to.be.true;
    expect(await store.incrementAndCheck(key, 5)).to.be.true;
  });

  it('should count each IP address independently', async () => {
    const first = new RateLimitKey('10.0.0.1', 'eth_chainId');
    const second = new RateLimitKey('10.0.0.2', 'eth_chainId');

    for (let i = 0; i < 2; i++) {
      await store.incrementAndCheck(first, 2);
    }

    expect(await store.incrementAndCheck(first, 2)).to.be.true;
    expect(await store.incrementAndCheck(second, 2)).to.be.false;
  });

  it('should count each method independently', async () => {
    const chainId = new RateLimitKey('10.0.1.1', 'eth_chainId');
    const blockNumber = new RateLimitKey('10.0.1.1', 'eth_blockNumber');

    for (let i = 0; i < 2; i++) {
      await store.incrementAndCheck(chainId, 2);
    }

    expect(await store.incrementAndCheck(chainId, 2)).to.be.true;
    expect(await store.incrementAndCheck(blockNumber, 2)).to.be.false;
  });

  it('should set the expiry on the first request only', async () => {
    const key = uniqueKey();

    await store.incrementAndCheck(key, 5);
    const ttlAfterFirst = await redisClient.ttl(key.toString());
    expect(ttlAfterFirst).to.be.greaterThan(0);

    await store.incrementAndCheck(key, 5);
    const ttlAfterSecond = await redisClient.ttl(key.toString());
    expect(ttlAfterSecond).to.be.at.most(ttlAfterFirst);
  });

  it('should allow requests again once the window has elapsed', async () => {
    const key = uniqueKey();

    for (let i = 0; i < 3; i++) {
      await store.incrementAndCheck(key, 2);
    }
    expect(await store.incrementAndCheck(key, 2)).to.be.true;

    await new Promise((resolve) => setTimeout(resolve, duration + 500));

    expect(await store.incrementAndCheck(key, 2)).to.be.false;
  });

  it('should count concurrent requests atomically', async () => {
    const key = uniqueKey();
    const limit = 10;

    const results = await Promise.all(Array.from({ length: 25 }, () => store.incrementAndCheck(key, limit)));

    expect(results.filter((blocked) => !blocked)).to.have.lengthOf(limit);
  });

  it('should return the Lua reply as a number, not a string', async () => {
    const key = uniqueKey();

    const underLimit = await redisClient.eval(RedisRateLimitStore['LUA_SCRIPT'], {
      keys: [key.toString()],
      arguments: ['1', '10'],
    });
    const overLimit = await redisClient.eval(RedisRateLimitStore['LUA_SCRIPT'], {
      keys: [key.toString()],
      arguments: ['1', '10'],
    });

    expect(underLimit).to.equal(0);
    expect(overLimit).to.equal(1);
  });
});
