// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import type { RedisClientType } from 'redis';

import { RedisClientManager } from '../../src/relay/lib/clients/redisClientManager';
import { WsTestHelper } from '../ws-server/helper';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

/**
 * Protocol-level Redis-backed rate limiting tests.
 *
 * Prerequisites:
 *   - Redis must be reachable (REDIS_URL / REDIS_ENABLED must be set)
 *   - Both the HTTP and WebSocket servers must be running in-process
 *   - app.proxy = true must be set on both servers
 */
describe('@protocol-acceptance @ratelimiter-redis Redis Rate Limiting', () => {
  this.timeout(30_000);

  // Methods with one dedicated method per test to prevent counter bleed
  const TIER1_METHOD_A = 'eth_mining';
  const TIER1_METHOD_B = 'eth_syncing';
  const TIER2_METHOD_A = 'eth_blockNumber';
  const TIER2_METHOD_B = 'eth_gasPrice';
  const RATE_LIMIT = 2;
  const IP_RATE_LIMIT_ERROR_CODE = -32605;
  const IP_A = '10.0.0.1';
  const IP_B = '10.0.0.2';

  let redisClient: RedisClientType;
  const logger = pino({ level: 'trace' });

  WsTestHelper.overrideEnvsInMochaDescribe({
    RATE_LIMIT_DISABLED: false,
    TIER_1_RATE_LIMIT: RATE_LIMIT,
    TIER_2_RATE_LIMIT: RATE_LIMIT,
    TIER_3_RATE_LIMIT: RATE_LIMIT,
  });

  before(async () => {
    if (!RedisClientManager.isRedisEnabled()) {
      return this.skip();
    }
    redisClient = await RedisClientManager.getClient(logger);
  });

  beforeEach(async () => {
    if (!redisClient) return;
    await redisClient.flushAll();
  });

  after(async () => {});

  describe('Cross-transport counter sharing', () => {
    it('HTTP requests consume the same counter that blocks WebSocket requests', async () => {
      const [http, ws] = ALL_PROTOCOL_CLIENTS;

      // Exhaust the limit over HTTP
      for (let i = 0; i < RATE_LIMIT; i++) {
        const resp = await http.callRaw(TIER1_METHOD_A, [], { ip: IP_A });
        expect(resp.error, `HTTP request ${i + 1} should succeed`).to.not.exist;
      }

      // The next request over WS must be blocked (shared Redis counter)
      const wsResp = await ws.callRaw(TIER1_METHOD_A, [], { ip: IP_A });
      expect(wsResp.error, 'WS request should be rate limited after HTTP exhausted the counter').to.exist;
      expect(wsResp.error!.code).to.equal(IP_RATE_LIMIT_ERROR_CODE);
    });

    it('WebSocket requests consume the same counter that blocks HTTP requests', async () => {
      const [http, ws] = ALL_PROTOCOL_CLIENTS;

      // Exhaust the limit over WS
      for (let i = 0; i < RATE_LIMIT; i++) {
        const resp = await ws.callRaw(TIER1_METHOD_B, [], { ip: IP_A });
        expect(resp.error, `WS request ${i + 1} should succeed`).to.not.exist;
      }

      // The next request over HTTP must be blocked
      const httpResp = await http.callRaw(TIER1_METHOD_B, [], { ip: IP_A });
      expect(httpResp.error, 'HTTP request should be rate limited after WS exhausted the counter').to.exist;
      expect(httpResp.error!.code).to.equal(IP_RATE_LIMIT_ERROR_CODE);
    });

    it('interleaved HTTP and WS requests consume a single shared counter', async () => {
      const [http, ws] = ALL_PROTOCOL_CLIENTS;

      // 1 HTTP + 1 WS = RATE_LIMIT (2); the third must be blocked
      const resp1 = await http.callRaw(TIER2_METHOD_A, [], { ip: IP_A });
      expect(resp1.error, 'first request (HTTP) should succeed').to.not.exist;

      const resp2 = await ws.callRaw(TIER2_METHOD_A, [], { ip: IP_A });
      expect(resp2.error, 'second request (WS) should succeed').to.not.exist;

      const resp3 = await http.callRaw(TIER2_METHOD_A, [], { ip: IP_A });
      expect(resp3.error, 'third request should be rate limited').to.exist;
      expect(resp3.error!.code).to.equal(IP_RATE_LIMIT_ERROR_CODE);
    });

    it('Redis flush resets counters for both transports', async () => {
      const [http, ws] = ALL_PROTOCOL_CLIENTS;

      // Exhaust over HTTP
      for (let i = 0; i < RATE_LIMIT; i++) {
        await http.callRaw(TIER2_METHOD_B, [], { ip: IP_A });
      }
      const beforeFlush = await http.callRaw(TIER2_METHOD_B, [], { ip: IP_A });
      expect(beforeFlush.error, 'should be rate limited before flush').to.exist;

      await redisClient.flushAll();

      // Both transports should now be allowed again
      const afterFlushHttp = await http.callRaw(TIER2_METHOD_B, [], { ip: IP_A });
      expect(afterFlushHttp.error, 'HTTP should succeed after Redis flush').to.not.exist;

      const afterFlushWs = await ws.callRaw(TIER2_METHOD_B, [], { ip: IP_A });
      expect(afterFlushWs.error, 'WS should succeed after Redis flush').to.not.exist;
    });
  });

  describe('IP isolation', () => {
    it('exhausting the limit for IP_A does not affect IP_B', async () => {
      const [http] = ALL_PROTOCOL_CLIENTS;

      // Exhaust limit for IP_A
      for (let i = 0; i < RATE_LIMIT; i++) {
        const resp = await http.callRaw(TIER1_METHOD_A, [], { ip: IP_A });
        expect(resp.error, `IP_A request ${i + 1} should succeed`).to.not.exist;
      }
      const rateLimitedA = await http.callRaw(TIER1_METHOD_A, [], { ip: IP_A });
      expect(rateLimitedA.error, 'IP_A should be rate limited').to.exist;
      expect(rateLimitedA.error!.code).to.equal(IP_RATE_LIMIT_ERROR_CODE);

      // IP_B has an independent counter and must not be affected
      const respB = await http.callRaw(TIER1_METHOD_A, [], { ip: IP_B });
      expect(respB.error, 'IP_B should not be rate limited').to.not.exist;
    });

    it('IP isolation holds across transports', async () => {
      const [http, ws] = ALL_PROTOCOL_CLIENTS;

      // Exhaust limit for IP_A over WS
      for (let i = 0; i < RATE_LIMIT; i++) {
        const resp = await ws.callRaw(TIER1_METHOD_B, [], { ip: IP_A });
        expect(resp.error, `IP_A WS request ${i + 1} should succeed`).to.not.exist;
      }

      // IP_A is blocked on HTTP too (shared counter)
      const rateLimitedHttp = await http.callRaw(TIER1_METHOD_B, [], { ip: IP_A });
      expect(rateLimitedHttp.error, 'IP_A should be rate limited on HTTP').to.exist;
      expect(rateLimitedHttp.error!.code).to.equal(IP_RATE_LIMIT_ERROR_CODE);

      // IP_B is unaffected on both transports
      const respBHttp = await http.callRaw(TIER1_METHOD_B, [], { ip: IP_B });
      expect(respBHttp.error, 'IP_B should not be rate limited on HTTP').to.not.exist;

      const respBWs = await ws.callRaw(TIER1_METHOD_B, [], { ip: IP_B });
      expect(respBWs.error, 'IP_B should not be rate limited on WS').to.not.exist;
    });
  });
});
