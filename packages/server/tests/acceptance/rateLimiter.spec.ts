// SPDX-License-Identifier: Apache-2.0

import { RateLimiterService } from '@hashgraph/json-rpc-relay/src/lib/services';
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import { createClient, RedisClientType } from 'redis';

describe('@ratelimiter Shared Rate Limiting Acceptance Tests', function () {
  this.timeout(30 * 1000); // 30 seconds

  let redisClient: RedisClientType;
  let serviceA: RateLimiterService;
  let serviceB: RateLimiterService;
  let logger: pino.Logger;
  let registryA: Registry;
  let registryB: Registry;

  const LIMIT = 5; // Rate limit threshold for testing
  const DURATION = 2000; // 2 seconds duration for testing
  const TEST_IP = '192.168.1.100';
  const TEST_METHOD = 'eth_chainId';
  const REQUEST_ID = 'test-request-123';

  before(async function () {
    // Set up Redis configuration for testing
    process.env.REDIS_ENABLED = 'true';
    process.env.IP_RATE_LIMIT_STORE = 'REDIS';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.RATE_LIMIT_DISABLED = 'false';

    // Create Redis client for test setup and cleanup
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();

    // Create loggers and registries for both services
    logger = pino({ level: 'silent' }); // Silent logger for tests
    registryA = new Registry();
    registryB = new Registry();

    // Create two RateLimiterService instances pointing to the same Redis
    serviceA = new RateLimiterService(logger.child({ service: 'A' }), registryA, DURATION);
    serviceB = new RateLimiterService(logger.child({ service: 'B' }), registryB, DURATION);

    // Wait for Redis connections to establish and verify they're connected
    let retries = 10;
    while (retries > 0) {
      const connectedA = await serviceA.isRedisConnected();
      const connectedB = await serviceB.isRedisConnected();
      if (connectedA && connectedB) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries--;
    }

    // Verify both services are connected to Redis
    const finalConnectedA = await serviceA.isRedisConnected();
    const finalConnectedB = await serviceB.isRedisConnected();
    if (!finalConnectedA || !finalConnectedB) {
      throw new Error(`Redis connection failed: serviceA=${finalConnectedA}, serviceB=${finalConnectedB}`);
    }
  });

  after(async function () {
    // Clean up services and Redis connections
    await serviceA.disconnect();
    await serviceB.disconnect();
    await redisClient.quit();

    // Clean up environment variables
    delete process.env.REDIS_ENABLED;
    delete process.env.IP_RATE_LIMIT_STORE;
    delete process.env.REDIS_URL;
    delete process.env.RATE_LIMIT_DISABLED;
  });

  beforeEach(async function () {
    // Clear Redis state before each test
    await redisClient.flushAll();
  });

  describe('Shared Rate Limiting Between Services', function () {
    it('should share rate limit counters between two service instances', async function () {
      // Verify both services are using Redis
      const redisA = await serviceA.isRedisConnected();
      const redisB = await serviceB.isRedisConnected();
      expect(redisA).to.be.true;
      expect(redisB).to.be.true;

      let rateLimited = false;

      // Make exactly LIMIT requests through serviceA to hit the limit
      for (let i = 0; i < LIMIT; i++) {
        rateLimited = await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
        expect(rateLimited).to.be.false;
      }

      // Check Redis state manually to debug
      const key = `ratelimit:${TEST_IP}:${TEST_METHOD}`;
      const currentCount = await redisClient.get(key);
      console.log(`Redis key ${key} has value: ${currentCount}`);

      // The next request through serviceB should be rate limited (shared state)
      rateLimited = await serviceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(rateLimited).to.be.true;
    });

    it('should immediately rate limit on serviceB after serviceA hits the limit', async function () {
      // Hit the rate limit using serviceA
      for (let i = 0; i < LIMIT; i++) {
        await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      }

      // Next request on serviceA should be rate limited
      const rateLimitedA = await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(rateLimitedA).to.be.true;

      // Next request on serviceB should also be rate limited (shared state)
      const rateLimitedB = await serviceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(rateLimitedB).to.be.true;
    });

    it('should distribute requests across services without interference', async function () {
      // Make requests distributed across both services
      // Total should still respect the shared limit

      let totalRequests = 0;
      let rateLimited = false;

      // Alternate between services until we hit the limit
      while (!rateLimited && totalRequests < LIMIT * 2) {
        if (totalRequests % 2 === 0) {
          rateLimited = await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
        } else {
          rateLimited = await serviceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
        }
        totalRequests++;
      }

      // Should have been rate limited after exactly LIMIT + 1 requests
      expect(rateLimited).to.be.true;
      expect(totalRequests).to.equal(LIMIT + 1);
    });

    it('should reset rate limits for both services after duration expires', async function () {
      // Hit the rate limit using serviceA
      for (let i = 0; i <= LIMIT; i++) {
        await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      }

      // Both services should be rate limited
      let rateLimitedA = await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      let rateLimitedB = await serviceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(rateLimitedA).to.be.true;
      expect(rateLimitedB).to.be.true;

      // Wait for the duration to expire
      await new Promise((resolve) => setTimeout(resolve, DURATION + 100));

      // Both services should allow requests again
      rateLimitedA = await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      rateLimitedB = await serviceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(rateLimitedA).to.be.false;
      expect(rateLimitedB).to.be.false;
    });
  });

  describe('Independent Rate Limiting by IP and Method', function () {
    it('should maintain separate counters for different IPs', async function () {
      const IP_A = '192.168.1.100';
      const IP_B = '192.168.1.101';

      // Hit the limit for IP_A using serviceA
      for (let i = 0; i <= LIMIT; i++) {
        await serviceA.shouldRateLimit(IP_A, TEST_METHOD, LIMIT, REQUEST_ID);
      }

      // IP_A should be rate limited on both services
      let rateLimitedA = await serviceA.shouldRateLimit(IP_A, TEST_METHOD, LIMIT, REQUEST_ID);
      let rateLimitedB = await serviceB.shouldRateLimit(IP_A, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(rateLimitedA).to.be.true;
      expect(rateLimitedB).to.be.true;

      // IP_B should still be allowed on both services
      rateLimitedA = await serviceA.shouldRateLimit(IP_B, TEST_METHOD, LIMIT, REQUEST_ID);
      rateLimitedB = await serviceB.shouldRateLimit(IP_B, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(rateLimitedA).to.be.false;
      expect(rateLimitedB).to.be.false;
    });

    it('should maintain separate counters for different methods', async function () {
      const METHOD_A = 'eth_chainId';
      const METHOD_B = 'eth_blockNumber';

      // Hit the limit for METHOD_A using serviceA
      for (let i = 0; i <= LIMIT; i++) {
        await serviceA.shouldRateLimit(TEST_IP, METHOD_A, LIMIT, REQUEST_ID);
      }

      // METHOD_A should be rate limited on both services
      let rateLimitedA = await serviceA.shouldRateLimit(TEST_IP, METHOD_A, LIMIT, REQUEST_ID);
      let rateLimitedB = await serviceB.shouldRateLimit(TEST_IP, METHOD_A, LIMIT, REQUEST_ID);
      expect(rateLimitedA).to.be.true;
      expect(rateLimitedB).to.be.true;

      // METHOD_B should still be allowed on both services
      rateLimitedA = await serviceA.shouldRateLimit(TEST_IP, METHOD_B, LIMIT, REQUEST_ID);
      rateLimitedB = await serviceB.shouldRateLimit(TEST_IP, METHOD_B, LIMIT, REQUEST_ID);
      expect(rateLimitedA).to.be.false;
      expect(rateLimitedB).to.be.false;
    });
  });

  describe('Service Independence and Failover', function () {
    it('should maintain independent Redis connections', async function () {
      // Both services should report connected to Redis
      const connectedA = await serviceA.isRedisConnected();
      const connectedB = await serviceB.isRedisConnected();
      expect(connectedA).to.be.true;
      expect(connectedB).to.be.true;
    });

    it('should handle concurrent requests from both services', async function () {
      // Send concurrent requests from both services
      const promises: Promise<boolean>[] = [];

      // Send exactly LIMIT requests total to hit the limit
      const totalRequests = LIMIT;
      for (let i = 0; i < totalRequests; i++) {
        if (i % 2 === 0) {
          promises.push(serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID));
        } else {
          promises.push(serviceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID));
        }
      }

      const results = await Promise.all(promises);

      // All requests within the limit should be allowed
      const rateLimitedCount = results.filter((result) => result === true).length;
      expect(rateLimitedCount).to.equal(0);

      // The next request should be rate limited since we've hit the limit
      const nextRequest = await serviceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, REQUEST_ID);
      expect(nextRequest).to.be.true;
    });
  });
});
