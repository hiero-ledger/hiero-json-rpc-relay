// SPDX-License-Identifier: Apache-2.0

import { CACHE_LEVEL, CacheService } from '@hashgraph/json-rpc-relay/dist/lib/services/cacheService/cacheService';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { expect } from 'chai';
import { Registry } from 'prom-client';

import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../../relay/tests/helpers';

const registry = new Registry();

const DATA_LABEL_PREFIX = 'acceptance-test-';
const DATA = {
  foo: 'bar',
};
const CALLING_METHOD = 'AcceptanceTest';

describe('@cache-service Acceptance Tests for shared cache', function () {
  let cacheService: CacheService;

  const requestDetails = new RequestDetails({ requestId: 'cacheServiceTest', ipAddress: '0.0.0.0' });

  before(async () => {
    cacheService = CacheService.getInstance(CACHE_LEVEL.L1);
    await new Promise((r) => setTimeout(r, 1000));
  });

  it('Correctly performs set, get and delete operations', async () => {
    const dataLabel = `${DATA_LABEL_PREFIX}1`;

    await cacheService.set(dataLabel, DATA, CALLING_METHOD, requestDetails);
    await new Promise((r) => setTimeout(r, 200));

    const cache = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(cache).to.deep.eq(DATA, 'set method saves to shared cache');

    const cacheFromService = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(cacheFromService).to.deep.eq(DATA, 'getAsync method reads correctly from shared cache');

    await cacheService.delete(dataLabel, CALLING_METHOD, requestDetails);
    await new Promise((r) => setTimeout(r, 200));

    const deletedCache = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(deletedCache).to.eq(null, 'the delete method correctly deletes from shared cache');

    const deletedCacheFromService = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(deletedCacheFromService).to.eq(null, 'getAsync method cannot read deleted cache');
  });

  it('Correctly sets TTL time', async () => {
    const ttl = 200;
    const dataLabel = `${DATA_LABEL_PREFIX}2`;

    await cacheService.set(dataLabel, DATA, CALLING_METHOD, requestDetails, ttl);
    await new Promise((r) => setTimeout(r, 100));

    const cache = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(cache).to.deep.eq(DATA, 'data is stored with TTL');

    await new Promise((r) => setTimeout(r, ttl));

    const expiredCache = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(expiredCache).to.eq(null, 'cache expires after TTL period');

    const deletedCacheFromService = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(deletedCacheFromService).to.eq(null, 'getAsync method cannot read expired cache');
  });

  withOverriddenEnvsInMochaTest({ REDIS_ENABLED: false }, () => {
    it('Falls back to local cache for REDIS_ENABLED !== true', async () => {
      const dataLabel = `${DATA_LABEL_PREFIX}3`;

      const serviceWithDisabledRedis = CacheService.getInstance(CACHE_LEVEL.L1);
      await new Promise((r) => setTimeout(r, 1000));
      expect(serviceWithDisabledRedis.isRedisEnabled()).to.eq(false, 'redis is disabled');
      await serviceWithDisabledRedis.set(dataLabel, DATA, CALLING_METHOD, requestDetails);
      await new Promise((r) => setTimeout(r, 200));

      const dataInLRU = await serviceWithDisabledRedis.getAsync(dataLabel, CALLING_METHOD, requestDetails);
      expect(dataInLRU).to.deep.eq(DATA, 'data is stored in local cache');
    });
  });

  it('Cache set by one instance can be accessed by another', async () => {
    const dataLabel = `${DATA_LABEL_PREFIX}4`;
    const otherServiceInstance = CacheService.getInstance(CACHE_LEVEL.L1);
    await cacheService.set(dataLabel, DATA, CALLING_METHOD, requestDetails);
    await new Promise((r) => setTimeout(r, 200));

    const cachedData = await otherServiceInstance.getAsync(dataLabel, CALLING_METHOD, requestDetails);
    expect(cachedData).to.deep.eq(DATA, 'cached data is read correctly by other service instance');
  });

  describe('fallback to local cache in case of Redis error', async () => {
    const dataLabel = `${DATA_LABEL_PREFIX}_redis_error`;

    let cacheService: CacheService;

    overrideEnvsInMochaDescribe({ REDIS_ENABLED: true });

    before(async () => {
      cacheService = CacheService.getInstance(CACHE_LEVEL.L1);

      // disconnect redis client to simulate Redis error
      await cacheService.disconnectRedisClient();
      await new Promise((r) => setTimeout(r, 1000));
    });

    it('test getAsync operation', async () => {
      await cacheService.set(dataLabel, DATA, CALLING_METHOD, requestDetails);
      await new Promise((r) => setTimeout(r, 200));

      const dataInLRU = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
      expect(dataInLRU).to.deep.eq(DATA, 'data is stored in local cache');
    });

    it('test multiSet operation', async () => {
      const pairs = {
        boolean: true,
        int: -1,
        string: '5644',
      };

      await cacheService.multiSet(pairs, CALLING_METHOD, requestDetails);
      await new Promise((r) => setTimeout(r, 200));

      for (const key in pairs) {
        const cachedValue = await cacheService.getAsync(key, CALLING_METHOD, requestDetails);
        expect(cachedValue).deep.equal(pairs[key]);
      }
    });

    it('test delete operation', async () => {
      await cacheService.set(dataLabel, DATA, CALLING_METHOD, requestDetails);
      await new Promise((r) => setTimeout(r, 200));

      await cacheService.delete(dataLabel, CALLING_METHOD, requestDetails);
      const dataInLRU = await cacheService.getAsync(dataLabel, CALLING_METHOD, requestDetails);
      expect(dataInLRU).to.be.null;
    });
  });
});
