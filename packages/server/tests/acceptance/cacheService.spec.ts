// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { RedisCache } from '@hashgraph/json-rpc-relay/dist/lib/clients/cache/redisCache';
import { CacheClientFactory } from '@hashgraph/json-rpc-relay/dist/lib/factories/cacheClientFactory';
import { CacheService } from '@hashgraph/json-rpc-relay/dist/lib/services/cacheService/cacheService';
import { RedisClientManager } from '@hashgraph/json-rpc-relay/src/lib/clients/redisClientManager';
import { expect } from 'chai';
import pino, { type Logger } from 'pino';
import { RedisClientType } from 'redis';
import sinon from 'sinon';

import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../../relay/tests/helpers';

const DATA_LABEL_PREFIX = 'acceptance-test-';
const DATA = {
  foo: 'bar',
};
const CALLING_METHOD = 'AcceptanceTest';

describe('@cache-service Acceptance Tests for shared cache', function () {
  let cacheService: CacheService;
  let logger: Logger;
  let redisClient: RedisClientType;

  before(async () => {
    logger = pino({ level: 'silent' });

    redisClient = await RedisClientManager.getClient(logger);
    cacheService = CacheClientFactory.create(logger, undefined, undefined, redisClient);

    await new Promise((r) => setTimeout(r, 1000));
  });

  it('Correctly performs set, get and delete operations', async () => {
    const dataLabel = `${DATA_LABEL_PREFIX}1`;
    const setSharedCacheSpy = sinon.spy(cacheService, 'set');
    const getSharedCacheSpy = sinon.spy(cacheService, 'getAsync');
    const deleteSharedCacheSpy = sinon.spy(cacheService, 'delete');
    await cacheService.set(dataLabel, DATA, CALLING_METHOD);
    await new Promise((r) => setTimeout(r, 200));

    const cache = await cacheService.getAsync(dataLabel, CALLING_METHOD);
    expect(cache).to.deep.eq(DATA, 'set method saves to shared cache');

    expect(cacheService['decoratedCacheClient']).to.be.instanceOf(RedisCache);

    const cacheFromService = await cacheService.getAsync(dataLabel, CALLING_METHOD);
    expect(cacheFromService).to.deep.eq(DATA, 'getAsync method reads correctly from shared cache');

    await cacheService.delete(dataLabel, CALLING_METHOD);
    await new Promise((r) => setTimeout(r, 200));

    const deletedCache = await cacheService.getAsync(dataLabel, CALLING_METHOD);
    expect(deletedCache).to.eq(null, 'the delete method correctly deletes from shared cache');

    const deletedCacheFromService = await cacheService.getAsync(dataLabel, CALLING_METHOD);
    expect(deletedCacheFromService).to.eq(null, 'getAsync method cannot read deleted cache');

    expect(setSharedCacheSpy.calledOnce).to.be.true;
    expect(getSharedCacheSpy.called).to.be.true;
    expect(deleteSharedCacheSpy.calledOnce).to.be.true;
  });

  it('Correctly sets TTL time', async () => {
    const ttl = 200;
    const dataLabel = `${DATA_LABEL_PREFIX}2`;

    await cacheService.set(dataLabel, DATA, CALLING_METHOD, ttl);
    await new Promise((r) => setTimeout(r, 100));

    const cache = await cacheService.getAsync(dataLabel, CALLING_METHOD);
    expect(cache).to.deep.eq(DATA, 'data is stored with TTL');

    await new Promise((r) => setTimeout(r, ttl));

    const expiredCache = await cacheService.getAsync(dataLabel, CALLING_METHOD);
    expect(expiredCache).to.eq(null, 'cache expires after TTL period');

    const deletedCacheFromService = await cacheService.getAsync(dataLabel, CALLING_METHOD);
    expect(deletedCacheFromService).to.eq(null, 'getAsync method cannot read expired cache');
  });

  withOverriddenEnvsInMochaTest({ REDIS_ENABLED: false }, () => {
    it('Falls back to local cache for REDIS_ENABLED !== true', async () => {
      const dataLabel = `${DATA_LABEL_PREFIX}3`;

      const serviceWithDisabledRedis = CacheClientFactory.create(logger);
      const isRedisEnabled = ConfigService.get('REDIS_ENABLED') && !!ConfigService.get('REDIS_URL');
      await new Promise((r) => setTimeout(r, 1000));
      expect(isRedisEnabled).to.eq(false);
      await serviceWithDisabledRedis.set(dataLabel, DATA, CALLING_METHOD);
      await new Promise((r) => setTimeout(r, 200));

      const dataInLRU = await serviceWithDisabledRedis.getAsync(dataLabel, CALLING_METHOD);
      expect(dataInLRU).to.deep.eq(DATA, 'data is stored in local cache');
    });
  });

  it('Cache set by one instance can be accessed by another', async () => {
    const dataLabel = `${DATA_LABEL_PREFIX}4`;
    const otherServiceInstance = CacheClientFactory.create(logger, undefined, undefined, redisClient);
    await cacheService.set(dataLabel, DATA, CALLING_METHOD);
    await new Promise((r) => setTimeout(r, 200));

    const cachedData = await otherServiceInstance.getAsync(dataLabel, CALLING_METHOD);
    expect(cachedData).to.deep.eq(DATA, 'cached data is read correctly by other service instance');
  });

  describe('fallback to local cache in case of Redis error', async () => {
    const dataLabel = `${DATA_LABEL_PREFIX}_redis_error`;

    overrideEnvsInMochaDescribe({ REDIS_ENABLED: true });

    before(async () => {
      // disconnect redis client to simulate Redis error
      await RedisClientManager.disconnect();
      await new Promise((r) => setTimeout(r, 1000));
    });

    it('tests missing fallback of getAsync operation', async () => {
      await cacheService.set(dataLabel, DATA, CALLING_METHOD);
      await new Promise((r) => setTimeout(r, 200));

      const dataInLRU = await cacheService.getAsync(dataLabel, CALLING_METHOD);
      expect(dataInLRU).to.be.null;
    });

    it('test multiSet operation', async () => {
      const pairs = {
        boolean: true,
        int: -1,
        string: '5644',
      };

      await cacheService.multiSet(pairs, CALLING_METHOD);
      await new Promise((r) => setTimeout(r, 200));

      for (const key in pairs) {
        const cachedValue = await cacheService.getAsync(key, CALLING_METHOD);
        expect(cachedValue).to.be.null;
      }
    });

    it('test delete operation', async () => {
      await cacheService.set(dataLabel, DATA, CALLING_METHOD);
      await new Promise((r) => setTimeout(r, 200));

      await cacheService.delete(dataLabel, CALLING_METHOD);
      const dataInLRU = await cacheService.getAsync(dataLabel, CALLING_METHOD);
      expect(dataInLRU).to.be.null;
    });

    it('test clear operation', async () => {
      await cacheService.set(dataLabel, DATA, CALLING_METHOD);
      await new Promise((r) => setTimeout(r, 200));

      await cacheService.clear();
      const dataInLRU = await cacheService.getAsync(dataLabel, CALLING_METHOD);
      expect(dataInLRU).to.be.null;
    });
  });
});
