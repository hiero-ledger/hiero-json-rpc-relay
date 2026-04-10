// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { WsTestHelper } from '../ws-server/helper';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

/**
 * Protocol-level rate limiting tests.
 */
describe('@protocol-acceptance @ratelimiter Rate Limiting', () => {
  this.timeout(30_000);

  WsTestHelper.overrideEnvsInMochaDescribe({
    RATE_LIMIT_DISABLED: false,
    TIER_1_RATE_LIMIT: 2,
    TIER_2_RATE_LIMIT: 2,
    TIER_3_RATE_LIMIT: 2,
  });

  const RATE_LIMIT = 2;
  const IP_RATE_LIMIT_ERROR_CODE = -32605;

  /**
   * Sends `limit` requests that must all succeed, then sends one more that must
   * be rejected with the IP rate limit error code (-32605)
   */
  async function assertRateLimitedAfterN(
    client: (typeof ALL_PROTOCOL_CLIENTS)[number],
    method: string,
    params: any[],
    limit: number,
  ): Promise<void> {
    for (let i = 0; i < limit; i++) {
      const response = await client.callRaw(method, params);
      expect(response.error, `[${client.label}] Request ${i + 1} for ${method} should succeed`).to.not.exist;
    }

    const rateLimitedResponse = await client.callRaw(method, params);
    expect(rateLimitedResponse.error, `[${client.label}] Request ${limit + 1} for ${method} should be rate limited`).to
      .exist;
    expect(rateLimitedResponse.error.code).to.equal(IP_RATE_LIMIT_ERROR_CODE);
    expect(rateLimitedResponse.error.message).to.include('IP Rate limit exceeded');
    expect(rateLimitedResponse.error.message).to.include(method);
  }

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(`${client.label} transport`, () => {
      describe('Tier 1 methods', () => {
        it('should rate limit eth_mining after the limit is exceeded', async () => {
          await assertRateLimitedAfterN(client, 'eth_mining', [], RATE_LIMIT);
        });

        it('should rate limit eth_syncing after the limit is exceeded', async () => {
          await assertRateLimitedAfterN(client, 'eth_syncing', [], RATE_LIMIT);
        });
      });

      describe('Tier 2 methods', () => {
        it('should rate limit eth_blockNumber after the limit is exceeded', async () => {
          await assertRateLimitedAfterN(client, 'eth_blockNumber', [], RATE_LIMIT);
        });

        it('should rate limit eth_gasPrice after the limit is exceeded', async () => {
          await assertRateLimitedAfterN(client, 'eth_gasPrice', [], RATE_LIMIT);
        });

        it('should rate limit eth_accounts after the limit is exceeded', async () => {
          await assertRateLimitedAfterN(client, 'eth_accounts', [], RATE_LIMIT);
        });
      });

      describe('Tier 3 methods', () => {
        it('should rate limit web3_clientVersion after the limit is exceeded', async () => {
          await assertRateLimitedAfterN(client, 'web3_clientVersion', [], RATE_LIMIT);
        });

        it('should rate limit net_listening after the limit is exceeded', async () => {
          await assertRateLimitedAfterN(client, 'net_listening', [], RATE_LIMIT);
        });
      });

      describe('Rate limit counter isolation', () => {
        it('should maintain independent counters per method', async () => {
          // exhaust the tier-1 limit for eth_hashrate
          for (let i = 0; i < RATE_LIMIT; i++) {
            const response = await client.callRaw('eth_hashrate', []);
            expect(response.error).to.not.exist;
          }
          const hashrateLimited = await client.callRaw('eth_hashrate', []);
          expect(hashrateLimited.error).to.exist;
          expect(hashrateLimited.error.code).to.equal(IP_RATE_LIMIT_ERROR_CODE);

          // net_version -tier 3- has its own independent counter and must still succeed
          const netVersionResponse = await client.callRaw('net_version', []);
          expect(netVersionResponse.error).to.not.exist;
        });
      });
    });
  }
});
