// SPDX-License-Identifier: Apache-2.0

import { IPRateLimiterService } from '@hashgraph/json-rpc-relay/src/lib/services';
import { RedisRateLimitStore } from '@hashgraph/json-rpc-relay/src/lib/services/rateLimiterService/RedisRateLimitStore';
import { RequestDetails } from '@hashgraph/json-rpc-relay/src/lib/types/RequestDetails';
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import { createClient, RedisClientType } from 'redis';

describe('@web-socket-ratelimiter Shared Rate Limiting Acceptance Tests', function () {
  this.timeout(30 * 1000); // 30 seconds

  let redisClient: RedisClientType;
  let wsServiceA: IPRateLimiterService;
  let wsServiceB: IPRateLimiterService;
  let logger: pino.Logger;
  let registryA: Registry;
  let registryB: Registry;

  const LIMIT = 5; // Rate limit threshold for testing
  const DURATION = 2000; // 2 seconds duration for testing
  const TEST_IP = '192.168.1.100';
  const TEST_METHOD = 'eth_gasPrice';
  const BATCH_METHOD = 'batch_request';
  const REQUEST_ID = 'ws-test-request-123';
  const requestDetails = new RequestDetails({ requestId: REQUEST_ID, ipAddress: TEST_IP });

  before(async function () {
    // Set up Redis configuration for WebSocket testing
    process.env.REDIS_ENABLED = 'true';
    process.env.IP_RATE_LIMIT_STORE = 'REDIS';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.RATE_LIMIT_DISABLED = 'false';

    // Create Redis client for test setup and cleanup
    redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();

    // Create loggers and registries for both WebSocket services
    logger = pino({ level: 'silent' }); // Silent logger for tests
    registryA = new Registry();
    registryB = new Registry();

    // Create two IPRateLimiterService instances for WebSocket servers pointing to the same Redis
    wsServiceA = new IPRateLimiterService(logger.child({ service: 'WS-A' }), registryA, DURATION);
    wsServiceB = new IPRateLimiterService(logger.child({ service: 'WS-B' }), registryB, DURATION);

    // Wait for Redis connections to establish and verify they're connected
    let retries = 10;
    while (retries > 0) {
      const storeA = wsServiceA.rateLimitStore;
      const storeB = wsServiceB.rateLimitStore;

      // Check if stores are Redis stores before accessing Redis methods
      if (storeA instanceof RedisRateLimitStore && storeB instanceof RedisRateLimitStore) {
        const connectedA = await storeA.isConnected();
        const connectedB = await storeB.isConnected();
        if (connectedA && connectedB) {
          break;
        }
      } else {
        // If not Redis stores, just break - LRU stores don't need connection setup
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries--;
    }

    // Verify both WebSocket services are connected to Redis (only if using Redis stores)
    const storeA = wsServiceA.rateLimitStore;
    const storeB = wsServiceB.rateLimitStore;
    if (storeA instanceof RedisRateLimitStore && storeB instanceof RedisRateLimitStore) {
      const finalConnectedA = await storeA.isConnected();
      const finalConnectedB = await storeB.isConnected();
      if (!finalConnectedA || !finalConnectedB) {
        throw new Error(`Redis connection failed: wsServiceA=${finalConnectedA}, wsServiceB=${finalConnectedB}`);
      }
    }
  });

  after(async function () {
    // Clean up WebSocket services and Redis connections
    const storeA = wsServiceA.rateLimitStore;
    const storeB = wsServiceB.rateLimitStore;

    // Only disconnect if stores are Redis stores
    if (storeA instanceof RedisRateLimitStore) {
      await storeA.disconnect();
    }
    if (storeB instanceof RedisRateLimitStore) {
      await storeB.disconnect();
    }

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

  describe('Shared WebSocket Rate Limiting Between Services', function () {
    it('should share rate limit counters between two WebSocket service instances', async function () {
      // Verify both WebSocket services are using Redis
      const storeA = wsServiceA.rateLimitStore;
      const storeB = wsServiceB.rateLimitStore;
      if (storeA instanceof RedisRateLimitStore && storeB instanceof RedisRateLimitStore) {
        const redisA = await storeA.isConnected();
        const redisB = await storeB.isConnected();
        expect(redisA).to.be.true;
        expect(redisB).to.be.true;
      }

      let rateLimited = false;

      // Make exactly LIMIT requests through wsServiceA to hit the limit
      for (let i = 0; i < LIMIT; i++) {
        rateLimited = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
        expect(rateLimited).to.be.false;
      }

      // Check Redis state manually to debug
      const key = `ratelimit:${TEST_IP}:${TEST_METHOD}`;
      const currentCount = await redisClient.get(key);
      console.log(`Redis key ${key} has value: ${currentCount}`);

      // The next request through wsServiceB should be rate limited (shared state)
      rateLimited = await wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(rateLimited).to.be.true;
    });

    it('should immediately rate limit on wsServiceB after wsServiceA hits the limit', async function () {
      // Hit the rate limit using wsServiceA
      for (let i = 0; i < LIMIT; i++) {
        await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      }

      // Next request on wsServiceA should be rate limited
      const rateLimitedA = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(rateLimitedA).to.be.true;

      // Next request on wsServiceB should also be rate limited (shared state)
      const rateLimitedB = await wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(rateLimitedB).to.be.true;
    });

    it('should distribute WebSocket requests across services without interference', async function () {
      // Make requests distributed across both WebSocket services
      // Total should still respect the shared limit

      let totalRequests = 0;
      let rateLimited = false;

      // Alternate between services until we hit the limit
      while (!rateLimited && totalRequests < LIMIT * 2) {
        if (totalRequests % 2 === 0) {
          rateLimited = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
        } else {
          rateLimited = await wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
        }
        totalRequests++;
      }

      // Should have been rate limited after exactly LIMIT + 1 requests
      expect(rateLimited).to.be.true;
      expect(totalRequests).to.equal(LIMIT + 1);
    });

    it('should reset rate limits for both WebSocket services after duration expires', async function () {
      // Hit the rate limit using wsServiceA
      for (let i = 0; i <= LIMIT; i++) {
        await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      }

      // Both WebSocket services should be rate limited
      let rateLimitedA = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      let rateLimitedB = await wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(rateLimitedA).to.be.true;
      expect(rateLimitedB).to.be.true;

      // Wait for the duration to expire
      await new Promise((resolve) => setTimeout(resolve, DURATION + 100));

      // Both WebSocket services should allow requests again
      rateLimitedA = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      rateLimitedB = await wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(rateLimitedA).to.be.false;
      expect(rateLimitedB).to.be.false;
    });
  });

  describe('WebSocket Batch Request Shared Rate Limiting', function () {
    it('should share rate limit counters for batch requests between WebSocket services', async function () {
      let rateLimited = false;

      // Make exactly LIMIT batch requests through wsServiceA to hit the limit
      for (let i = 0; i < LIMIT; i++) {
        rateLimited = await wsServiceA.shouldRateLimit(TEST_IP, BATCH_METHOD, LIMIT, requestDetails);
        expect(rateLimited).to.be.false;
      }

      // The next batch request through wsServiceB should be rate limited (shared state)
      rateLimited = await wsServiceB.shouldRateLimit(TEST_IP, BATCH_METHOD, LIMIT, requestDetails);
      expect(rateLimited).to.be.true;
    });

    it('should maintain separate counters for single vs batch requests across WebSocket services', async function () {
      // Hit the limit for single requests using wsServiceA
      for (let i = 0; i <= LIMIT; i++) {
        await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      }

      // Single requests should be rate limited on both services
      let rateLimitedA = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      let rateLimitedB = await wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(rateLimitedA).to.be.true;
      expect(rateLimitedB).to.be.true;

      // Batch requests should still be allowed on both services (separate counters)
      rateLimitedA = await wsServiceA.shouldRateLimit(TEST_IP, BATCH_METHOD, LIMIT, requestDetails);
      rateLimitedB = await wsServiceB.shouldRateLimit(TEST_IP, BATCH_METHOD, LIMIT, requestDetails);
      expect(rateLimitedA).to.be.false;
      expect(rateLimitedB).to.be.false;
    });
  });

  describe('Independent WebSocket Rate Limiting by IP and Method', function () {
    it('should maintain separate counters for different IPs across WebSocket services', async function () {
      const IP_A = '192.168.1.100';
      const IP_B = '192.168.1.101';
      const requestDetailsA = new RequestDetails({ requestId: REQUEST_ID, ipAddress: IP_A });
      const requestDetailsB = new RequestDetails({ requestId: REQUEST_ID, ipAddress: IP_B });

      // Hit the limit for IP_A using wsServiceA
      for (let i = 0; i <= LIMIT; i++) {
        await wsServiceA.shouldRateLimit(IP_A, TEST_METHOD, LIMIT, requestDetailsA);
      }

      // IP_A should be rate limited on both WebSocket services
      let rateLimitedA = await wsServiceA.shouldRateLimit(IP_A, TEST_METHOD, LIMIT, requestDetailsA);
      let rateLimitedB = await wsServiceB.shouldRateLimit(IP_A, TEST_METHOD, LIMIT, requestDetailsA);
      expect(rateLimitedA).to.be.true;
      expect(rateLimitedB).to.be.true;

      // IP_B should still be allowed on both WebSocket services
      rateLimitedA = await wsServiceA.shouldRateLimit(IP_B, TEST_METHOD, LIMIT, requestDetailsB);
      rateLimitedB = await wsServiceB.shouldRateLimit(IP_B, TEST_METHOD, LIMIT, requestDetailsB);
      expect(rateLimitedA).to.be.false;
      expect(rateLimitedB).to.be.false;
    });

    it('should maintain separate counters for different WebSocket methods', async function () {
      const METHOD_A = 'eth_gasPrice';
      const METHOD_B = 'eth_blockNumber';

      // Hit the limit for METHOD_A using wsServiceA
      for (let i = 0; i <= LIMIT; i++) {
        await wsServiceA.shouldRateLimit(TEST_IP, METHOD_A, LIMIT, requestDetails);
      }

      // METHOD_A should be rate limited on both WebSocket services
      let rateLimitedA = await wsServiceA.shouldRateLimit(TEST_IP, METHOD_A, LIMIT, requestDetails);
      let rateLimitedB = await wsServiceB.shouldRateLimit(TEST_IP, METHOD_A, LIMIT, requestDetails);
      expect(rateLimitedA).to.be.true;
      expect(rateLimitedB).to.be.true;

      // METHOD_B should still be allowed on both WebSocket services
      rateLimitedA = await wsServiceA.shouldRateLimit(TEST_IP, METHOD_B, LIMIT, requestDetails);
      rateLimitedB = await wsServiceB.shouldRateLimit(TEST_IP, METHOD_B, LIMIT, requestDetails);
      expect(rateLimitedA).to.be.false;
      expect(rateLimitedB).to.be.false;
    });
  });

  describe('WebSocket Service Independence and Failover', function () {
    it('should maintain independent Redis connections for WebSocket services', async function () {
      // Both WebSocket services should report connected to Redis
      const storeA = wsServiceA.rateLimitStore;
      const storeB = wsServiceB.rateLimitStore;
      if (storeA instanceof RedisRateLimitStore && storeB instanceof RedisRateLimitStore) {
        const connectedA = await storeA.isConnected();
        const connectedB = await storeB.isConnected();
        expect(connectedA).to.be.true;
        expect(connectedB).to.be.true;
      }
    });

    it('should handle concurrent WebSocket requests from both services', async function () {
      // Send concurrent requests from both WebSocket services
      const promises: Promise<boolean>[] = [];

      // Send exactly LIMIT requests total to hit the limit
      const totalRequests = LIMIT;
      for (let i = 0; i < totalRequests; i++) {
        if (i % 2 === 0) {
          promises.push(wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails));
        } else {
          promises.push(wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails));
        }
      }

      const results = await Promise.all(promises);

      // All requests within the limit should be allowed
      const rateLimitedCount = results.filter((result) => result === true).length;
      expect(rateLimitedCount).to.equal(0);

      // The next request should be rate limited since we've hit the limit
      const nextRequest = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(nextRequest).to.be.true;
    });
  });

  describe('WebSocket-Specific Rate Limiting Scenarios', function () {
    it('should handle mixed single and batch requests across WebSocket services', async function () {
      // Mix single and batch requests, alternating between services

      // Use up the single request limit exactly
      for (let i = 0; i < LIMIT; i++) {
        const rateLimited = await wsServiceA.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
        expect(rateLimited).to.be.false;
      }

      // Use up the batch request limit exactly
      for (let i = 0; i < LIMIT; i++) {
        const rateLimited = await wsServiceB.shouldRateLimit(TEST_IP, BATCH_METHOD, LIMIT, requestDetails);
        expect(rateLimited).to.be.false;
      }

      // Next single request should be rate limited
      const singleRateLimited = await wsServiceB.shouldRateLimit(TEST_IP, TEST_METHOD, LIMIT, requestDetails);
      expect(singleRateLimited).to.be.true;

      // Next batch request should be rate limited
      const batchRateLimited = await wsServiceA.shouldRateLimit(TEST_IP, BATCH_METHOD, LIMIT, requestDetails);
      expect(batchRateLimited).to.be.true;
    });

    it('should maintain rate limiting consistency during WebSocket connection handoffs', async function () {
      // Simulate a client switching between WebSocket servers mid-session
      const clientIP = '192.168.1.200';
      const clientRequestDetails = new RequestDetails({ requestId: REQUEST_ID, ipAddress: clientIP });

      // Client makes requests through wsServiceA (use up the limit exactly)
      for (let i = 0; i < LIMIT; i++) {
        const rateLimited = await wsServiceA.shouldRateLimit(clientIP, TEST_METHOD, LIMIT, clientRequestDetails);
        expect(rateLimited).to.be.false;
      }

      // Client switches to wsServiceB (connection handoff) - should be rate limited immediately
      const handoffRequest = await wsServiceB.shouldRateLimit(clientIP, TEST_METHOD, LIMIT, clientRequestDetails);
      expect(handoffRequest).to.be.true;

      // Any subsequent request should also be rate limited regardless of which service handles it
      const finalRequest = await wsServiceA.shouldRateLimit(clientIP, TEST_METHOD, LIMIT, clientRequestDetails);
      expect(finalRequest).to.be.true;
    });
  });
});
