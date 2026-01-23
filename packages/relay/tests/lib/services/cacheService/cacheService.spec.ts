// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { Registry } from 'prom-client';
import * as sinon from 'sinon';

import type { ICacheClient } from '../../../../src/lib/clients/cache/ICacheClient';
import { LocalLRUCache } from '../../../../src/lib/clients/cache/localLRUCache';
import { RedisClientManager } from '../../../../src/lib/clients/redisClientManager';
import { CacheClientFactory } from '../../../../src/lib/factories/cacheClientFactory';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('CacheService Test Suite', async function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const callingMethod = 'CacheServiceTest';

  let cacheService: ICacheClient;

  const initCacheEntriesForTests = async (datasetEntries) => {
    for (const [key, value] of Object.entries(datasetEntries)) {
      await cacheService.set(key, value, callingMethod);
    }
  };

  const describeKeysTestSuite = () => {
    describe('keys', async function () {
      let internalCacheSpy: sinon.SinonSpiedInstance<ICacheClient>;
      before(async () => {
        internalCacheSpy = sinon.spy(cacheService);
      });

      it('should retrieve all keys', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await initCacheEntriesForTests(entries);

        const keys = await cacheService.keys('*', callingMethod);
        expect(keys).to.have.members(Object.keys(entries));
      });

      it('should retrieve keys matching pattern', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await initCacheEntriesForTests(entries);

        const keys = await cacheService.keys('key*', callingMethod);
        expect(keys).to.have.members(Object.keys(entries));
      });

      it('should retrieve keys matching pattern with ?', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await initCacheEntriesForTests(entries);

        const keys = await cacheService.keys('key?', callingMethod);
        expect(keys).to.have.members(Object.keys(entries));
      });

      it('should retrieve keys matching pattern with []', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await initCacheEntriesForTests(entries);

        const keys = await cacheService.keys('key[1-2]', callingMethod);
        expect(keys).to.have.members(['key1', 'key2']);
      });

      it('should retrieve keys matching pattern with [^]', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await initCacheEntriesForTests(entries);

        // [^3] should match all keys except key3
        const keys = await cacheService.keys('key[^3]', callingMethod);
        expect(keys).to.have.members(['key1', 'key2']);
      });

      it('should retrieve keys matching pattern with [a-b]', async function () {
        const entries: Record<string, any> = {};
        entries['keya'] = 'value1';
        entries['keyb'] = 'value2';
        entries['keyc'] = 'value3';

        await initCacheEntriesForTests(entries);

        const keys = await cacheService.keys('key[a-c]', callingMethod);
        expect(keys).to.have.members(Object.keys(entries));
      });

      it('should escape special characters in the pattern', async function () {
        const key = 'h*llo';
        const value = 'value';

        await cacheService.set(key, value, callingMethod);

        const keys = await cacheService.keys('h*llo', callingMethod);
        expect(keys).to.have.members([key]);
      });

      if (RedisClientManager.isRedisEnabled()) {
        it('should retrieve keys from internal cache in case of Redis error', async function () {
          const entries: Record<string, any> = {};
          entries['key1'] = 'value1';
          entries['key2'] = 'value2';
          entries['key3'] = 'value3';

          await RedisClientManager.disconnect();
          await initCacheEntriesForTests(entries);
          const keys = await cacheService.keys('*', callingMethod);
          expect(keys).to.have.members(Object.keys(entries));
          expect(internalCacheSpy.set.called).to.be.true;
        });
      }
    });
  };

  describe('Internal Cache Test Suite', async function () {
    overrideEnvsInMochaDescribe({ REDIS_ENABLED: false });

    this.beforeAll(() => {
      cacheService = CacheClientFactory.create(logger, registry);
    });

    this.afterEach(async () => {
      await cacheService.clear();
    });

    it('should be able to set and get from internal cache', async function () {
      const key = 'string';
      const value = 'value';

      await cacheService.set(key, value, callingMethod);
      const cachedValue = await cacheService.getAsync(key, callingMethod);

      expect(cachedValue).eq(value);
    });

    it('should be able to set and delete from internal cache', async function () {
      const key = 'string';
      const value = 'value';

      await cacheService.set(key, value, callingMethod);
      await cacheService.delete(key, callingMethod);
      const cachedValue = await cacheService.getAsync(key, callingMethod);

      expect(cachedValue).to.be.null;
    });

    it('should be able to get from internal cache when calling getAsync', async function () {
      const key = 'string';
      const value = 'value';

      await cacheService.set(key, value, callingMethod);
      const cachedValue = await cacheService.getAsync(key, callingMethod);

      expect(cachedValue).eq(value);
    });

    it('should be able to set multiple keys and get them separately', async function () {
      const entries: Record<string, any> = {};
      entries['key1'] = 'value1';
      entries['key2'] = 'value2';
      entries['key3'] = 'value3';

      await initCacheEntriesForTests(entries);

      for (const [key, value] of Object.entries(entries)) {
        const valueFromCache = await cacheService.getAsync(key, callingMethod);
        expect(valueFromCache).eq(value);
      }
    });

    describe('incrBy', async function () {
      it('should increment value in internal cache', async function () {
        const key = 'counter';
        const amount = 5;

        await cacheService.set(key, 10, callingMethod);
        const newValue = await cacheService.incrBy(key, amount, callingMethod);

        expect(newValue).to.equal(15);
      });
    });

    describe('rPush', async function () {
      it('should push value to internal cache', async function () {
        const key = 'list';
        const value = 'item';

        await cacheService.rPush(key, value, callingMethod);
        const cachedValue = await cacheService.getAsync(key, callingMethod);

        expect(cachedValue).to.deep.equal([value]);
      });
    });

    describe('lRange', async function () {
      it('should retrieve range from internal cache', async function () {
        const key = 'list';
        const values = ['item1', 'item2', 'item3'];

        await cacheService.set(key, values, callingMethod);
        const range = await cacheService.lRange(key, 0, 1, callingMethod);

        expect(range).to.deep.equal(['item1', 'item2']);
      });

      it('should retrieve range with negative index from internal cache', async function () {
        const key = 'list';
        const values = ['item1', 'item2', 'item3'];

        await cacheService.set(key, values, callingMethod);
        const range = await cacheService.lRange(key, -2, -1, callingMethod);

        expect(range).to.deep.equal(['item2', 'item3']);
      });
    });

    describeKeysTestSuite();

    describe('should not initialize redis cache if shared cache is not enabled', async function () {
      it('should not initialize redis cache if shared cache is not enabled', async function () {
        expect(cacheService['decoratedCacheClient']).to.be.an.instanceOf(LocalLRUCache);
      });
    });
  });

  describe('Shared Cache Test Suite', async function () {
    useInMemoryRedisServer(logger, 6381);

    before(async () => {
      cacheService = CacheClientFactory.create(logger, registry, new Set(), await RedisClientManager.getClient(logger));
    });

    this.beforeEach(async () => {
      if (!(await RedisClientManager.isConnected())) {
        await RedisClientManager.connect();
      }
    });

    afterEach(async () => {
      await cacheService.clear();
    });

    it('should be able to set and get from shared cache', async function () {
      const key = 'string';
      const value = 'value';

      await cacheService.set(key, value, callingMethod);

      const cachedValue = await cacheService.getAsync(key, callingMethod);
      expect(cachedValue).eq(value);
    });

    it('should be able to set and delete from shared cache', async function () {
      const key = 'string';
      const value = 'value';

      await cacheService.set(key, value, callingMethod);

      await cacheService.delete(key, callingMethod);

      const cachedValue = await cacheService.getAsync(key, callingMethod);
      expect(cachedValue).to.be.null;
    });

    it('should be able to get from shared cache with fallback to internal cache', async function () {
      const key = 'string';
      const value = 'value';

      await cacheService.set(key, value, callingMethod);

      const cachedValue = await cacheService.getAsync(key, callingMethod);
      expect(cachedValue).eq(value);
    });

    it('should be able to ignore getAsync failure in case of Redis error', async function () {
      const key = 'string';
      await RedisClientManager.disconnect();

      const cachedValue = await cacheService.getAsync(key, callingMethod);
      expect(cachedValue).eq(null);
    });

    it('should be able to ignore set failure in case of Redis error', async function () {
      const key = 'string';
      const value = 'value';

      await RedisClientManager.disconnect();

      await expect(cacheService.set(key, value, callingMethod)).to.eventually.not.be.rejected;
    });

    it('should be able to ignore clear failure in case of Redis error', async function () {
      await RedisClientManager.disconnect();

      await expect(cacheService.clear()).to.eventually.not.be.rejected;
    });

    it('should be able to ignore delete failure in case of Redis error', async function () {
      const key = 'string';
      await RedisClientManager.disconnect();

      await expect(cacheService.delete(key, callingMethod)).to.eventually.not.be.rejected;
    });

    it('should be able to set to shared cache', async function () {
      const key = 'string';
      const value = 'value';

      await expect(cacheService.set(key, value, callingMethod)).to.eventually.not.be.rejected;
    });

    it('should be able to delete from shared cache', async function () {
      const key = 'string';

      await expect(cacheService.delete(key, callingMethod)).to.eventually.not.be.rejected;
    });

    describe('incrBy', async function () {
      it('should increment value in shared cache', async function () {
        const key = 'counter';
        const amount = 5;

        await cacheService.set(key, 10, callingMethod);
        const newValue = await cacheService.incrBy(key, amount, callingMethod);

        expect(newValue).to.equal(15);
      });

      it('should be able to ignore increment failure in case of Redis error', async function () {
        const key = 'counter';
        await cacheService.set(key, 10, callingMethod);
        await RedisClientManager.disconnect();
        await expect(cacheService.incrBy(key, 5, callingMethod)).to.eventually.not.be.rejected;
      });
    });

    describe('rPush', async function () {
      it('should push value to shared cache', async function () {
        const key = 'list';
        const value = 'item';

        await cacheService.rPush(key, value, callingMethod);
        const cachedValue = await cacheService.lRange(key, 0, -1, callingMethod);

        expect(cachedValue).to.deep.equal([value]);
      });

      it('should not push value in case of Redis error', async function () {
        const key = 'list';
        const value = 'item';

        await RedisClientManager.disconnect();

        await cacheService.rPush(key, value, callingMethod);
        const cachedValue = await cacheService.lRange(key, 0, -1, callingMethod);

        expect(cachedValue).to.deep.equal([]);
      });
    });

    describe('lRange', async function () {
      it('should retrieve range from shared cache', async function () {
        const key = 'list';
        const values = ['item1', 'item2', 'item3'];
        for (const item of values) {
          await cacheService.rPush(key, item, callingMethod);
        }

        const range = await cacheService.lRange(key, 0, 1, callingMethod);

        expect(range).to.deep.equal(['item1', 'item2']);
      });

      it('should retrieve range with negative index from shared cache', async function () {
        const key = 'list';
        const values = ['item1', 'item2', 'item3'];
        for (const item of values) {
          await cacheService.rPush(key, item, callingMethod);
        }

        const range = await cacheService.lRange(key, -2, -1, callingMethod);

        expect(range).to.deep.equal(['item2', 'item3']);
      });

      it('should not retrieve range in case of Redis error', async function () {
        await RedisClientManager.disconnect();

        const key = 'list';
        const values = ['item1', 'item2', 'item3'];
        for (const item of values) {
          await cacheService.rPush(key, item, callingMethod);
        }

        const range = await cacheService.lRange(key, 0, 1, callingMethod);

        expect(range).to.deep.equal([]);
      });
    });

    describeKeysTestSuite();
  });
});
