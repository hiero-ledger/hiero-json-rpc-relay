// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { Registry } from 'prom-client';
import * as sinon from 'sinon';

import { ICacheClient } from '../../../../src/lib/clients/cache/ICacheClient';
import { LocalLRUCache } from '../../../../src/lib/clients/cache/localLRUCache';
import { RedisClientManager } from '../../../../src/lib/clients/redisClientManager';
import { CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('CacheService Test Suite', async function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const callingMethod = 'CacheServiceTest';

  let cacheService: CacheService;
  let redisManager: RedisClientManager;
  const describeKeysTestSuite = () => {
    describe('keys', async function () {
      let internalCacheSpy: sinon.SinonSpiedInstance<ICacheClient>;
      before(async () => {
        internalCacheSpy = sinon.spy(cacheService['internalCache']);
      });

      it('should retrieve all keys', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await cacheService.multiSet(entries, callingMethod);

        const keys = await cacheService.keys('*', callingMethod);
        expect(keys).to.have.members(Object.keys(entries));
      });

      it('should retrieve keys matching pattern', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await cacheService.multiSet(entries, callingMethod);

        const keys = await cacheService.keys('key*', callingMethod);
        expect(keys).to.have.members(Object.keys(entries));
      });

      it('should retrieve keys matching pattern with ?', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await cacheService.multiSet(entries, callingMethod);

        const keys = await cacheService.keys('key?', callingMethod);
        expect(keys).to.have.members(Object.keys(entries));
      });

      it('should retrieve keys matching pattern with []', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await cacheService.multiSet(entries, callingMethod);

        const keys = await cacheService.keys('key[1-2]', callingMethod);
        expect(keys).to.have.members(['key1', 'key2']);
      });

      it('should retrieve keys matching pattern with [^]', async function () {
        const entries: Record<string, any> = {};
        entries['key1'] = 'value1';
        entries['key2'] = 'value2';
        entries['key3'] = 'value3';

        await cacheService.multiSet(entries, callingMethod);

        // [^3] should match all keys except key3
        const keys = await cacheService.keys('key[^3]', callingMethod);
        expect(keys).to.have.members(['key1', 'key2']);
      });

      it('should retrieve keys matching pattern with [a-b]', async function () {
        const entries: Record<string, any> = {};
        entries['keya'] = 'value1';
        entries['keyb'] = 'value2';
        entries['keyc'] = 'value3';

        await cacheService.multiSet(entries, callingMethod);

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

      if (ConfigService.get('REDIS_ENABLED')) {
        it('should retrieve keys from internal cache in case of Redis error', async function () {
          const entries: Record<string, any> = {};
          entries['key1'] = 'value1';
          entries['key2'] = 'value2';
          entries['key3'] = 'value3';

          await redisManager.disconnect();
          await cacheService.multiSet(entries, callingMethod);
          const keys = await cacheService.keys('*', callingMethod);
          expect(keys).to.have.members(Object.keys(entries));
          expect(internalCacheSpy.multiSet.called).to.be.true;
        });
      }
    });
  };

  describe('Internal Cache Test Suite', async function () {
    overrideEnvsInMochaDescribe({ REDIS_ENABLED: false });

    this.beforeAll(() => {
      cacheService = new CacheService(logger, registry);
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

    it('should be able to set using multiSet and get them separately', async function () {
      const entries: Record<string, any> = {};
      entries['key1'] = 'value1';
      entries['key2'] = 'value2';
      entries['key3'] = 'value3';

      await cacheService.multiSet(entries, callingMethod);

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
        expect(cacheService['sharedCache']).to.be.an.instanceOf(LocalLRUCache);
      });
    });
  });

  describe('Shared Cache Test Suite', async function () {
    const multiSetEntries: Record<string, string> = {
      key1: 'value1',
      key2: 'value2',
      key3: 'value3',
    };

    useInMemoryRedisServer(logger, 6381);
    overrideEnvsInMochaDescribe({ MULTI_SET: true });

    this.beforeAll(async () => {
      redisManager = new RedisClientManager(logger, 'redis://127.0.0.1:6381', 1000);
      await redisManager.connect();
      cacheService = new CacheService(logger, registry, new Set(), redisManager.getClient());
    });

    this.afterAll(async () => {
      await redisManager.disconnect();
    });

    // this.beforeEach(async () => {
    //   await redisManager.connect();
    // });

    this.afterEach(async () => {
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

    it('should be able to set using multiSet and get them separately using internal cache', async function () {
      await cacheService.multiSet(multiSetEntries, callingMethod);

      for (const [key, value] of Object.entries(multiSetEntries)) {
        const valueFromCache = await cacheService.getAsync(key, callingMethod);
        expect(valueFromCache).eq(value);
      }
    });

    it('should be able to set using pipelineSet and get them separately using internal cache', async function () {
      // @ts-ignore
      cacheService['shouldMultiSet'] = false;

      await cacheService.multiSet(multiSetEntries, callingMethod);

      for (const [key, value] of Object.entries(multiSetEntries)) {
        const valueFromCache = await cacheService.getAsync(key, callingMethod);
        expect(valueFromCache).eq(value);
      }
    });

    it('should be able to getAsync from internal cache in case of Redis error', async function () {
      const key = 'string';
      await redisManager.disconnect();

      const cachedValue = await cacheService.getAsync(key, callingMethod);
      expect(cachedValue).eq(null);
    });

    it('should be able to set to internal cache in case of Redis error', async function () {
      const key = 'string';
      const value = 'value';

      await redisManager.disconnect();

      await expect(cacheService.set(key, value, callingMethod)).to.eventually.not.be.rejected;

      const internalCacheRes = await cacheService.getAsync(key, callingMethod);
      expect(internalCacheRes).to.eq(value);
    });

    it('should be able to multiSet to internal cache in case of Redis error', async function () {
      await redisManager.disconnect();

      await expect(cacheService.multiSet(multiSetEntries, callingMethod)).to.eventually.not.be.rejected;

      for (const [key, value] of Object.entries(multiSetEntries)) {
        const internalCacheRes = await cacheService.getAsync(key, callingMethod);
        expect(internalCacheRes).to.eq(value);
      }
    });

    it('should be able to pipelineSet to internal cache in case of Redis error', async function () {
      // @ts-ignore
      cacheService['shouldMultiSet'] = false;

      await redisManager.disconnect();

      await expect(cacheService.multiSet(multiSetEntries, callingMethod)).to.eventually.not.be.rejected;

      for (const [key, value] of Object.entries(multiSetEntries)) {
        const internalCacheRes = await cacheService.getAsync(key, callingMethod);
        expect(internalCacheRes).to.eq(value);
      }
    });

    it('should be able to clear from internal cache in case of Redis error', async function () {
      await redisManager.disconnect();

      await expect(cacheService.clear()).to.eventually.not.be.rejected;
    });

    it('should be able to delete from internal cache in case of Redis error', async function () {
      const key = 'string';
      await redisManager.disconnect();

      await expect(cacheService.delete(key, callingMethod)).to.eventually.not.be.rejected;
    });

    it('should be able to set to shared cache', async function () {
      const key = 'string';
      const value = 'value';

      await expect(cacheService.set(key, value, callingMethod)).to.eventually.not.be.rejected;
    });

    it('should be able to multiset to shared cache', async function () {
      const items: Record<string, any> = {};
      items['key1'] = 'value1';
      items['key2'] = 'value2';

      await expect(cacheService.multiSet(items, callingMethod)).to.eventually.not.be.rejected;
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

      it('should increment value in internal cache in case of Redis error', async function () {
        const key = 'counter';
        const amount = 5;

        await redisManager.disconnect();

        await cacheService.set(key, 10, callingMethod);
        const newValue = await cacheService.incrBy(key, amount, callingMethod);

        expect(newValue).to.equal(15);
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

      it('should push value to internal cache in case of Redis error', async function () {
        const key = 'list';
        const value = 'item';

        await redisManager.disconnect();

        await cacheService.rPush(key, value, callingMethod);
        const cachedValue = await cacheService.lRange(key, 0, -1, callingMethod);

        expect(cachedValue).to.deep.equal([value]);
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

      it('should retrieve range from internal cache in case of Redis error', async function () {
        await redisManager.disconnect();

        const key = 'list';
        const values = ['item1', 'item2', 'item3'];
        for (const item of values) {
          await cacheService.rPush(key, item, callingMethod);
        }

        const range = await cacheService.lRange(key, 0, 1, callingMethod);

        expect(range).to.deep.equal(['item1', 'item2']);
      });
    });

    describeKeysTestSuite();

    describe('isRedisClientConnected', async function () {
      it('should return true if shared cache is enabled', async function () {
        expect(await redisManager.isConnected()).to.be.true;
      });

      it('should return false if shared cache is enabled and client is disconnected', async function () {
        await redisManager.disconnect();
        expect(await redisManager.isConnected()).to.be.false;
      });

      it('should return true if shared cache is enabled and client is reconnected', async function () {
        await redisManager.disconnect();
        await redisManager.connect();
        expect(await redisManager.isConnected()).to.be.true;
      });
    });

    describe('getNumberOfRedisConnections', async function () {
      it('should return 1 if shared cache is enabled', async function () {
        expect(await redisManager.getNumberOfConnections()).to.equal(1);
      });

      it('should return 0 if shared cache is enabled and client is disconnected', async function () {
        await redisManager.disconnect();
        expect(await redisManager.getNumberOfConnections()).to.equal(0);
      });

      it('should return 1 if shared cache is enabled and client is reconnected', async function () {
        await redisManager.disconnect();
        await redisManager.connect();
        expect(await redisManager.getNumberOfConnections()).to.equal(1);
      });
    });

    describe('connectRedisClient', async function () {
      it('should connect Redis client if shared cache is enabled', async function () {
        await redisManager.disconnect();
        await redisManager.connect();
        expect(await redisManager.isConnected()).to.be.true;
      });

      it('should not throw error if Redis client is already connected', async function () {
        await redisManager.connect();
        await expect(redisManager.connect()).to.not.be.rejected;
      });
    });

    describe('disconnectRedisClient', async function () {
      it('should disconnect Redis client if shared cache is enabled', async function () {
        const disconnectSpy = sinon.spy(cacheService['sharedCache'], <any>'disconnect');
        await redisManager.disconnect();
        expect(disconnectSpy.calledOnce).to.be.true;
      });

      it('should not throw error if Redis client is already disconnected', async function () {
        await redisManager.disconnect();
        await expect(redisManager.disconnect()).to.not.be.rejected;
      });
    });
  });
});
