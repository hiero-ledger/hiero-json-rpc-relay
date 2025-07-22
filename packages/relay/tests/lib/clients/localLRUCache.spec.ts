// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { LocalLRUCache } from '../../../src/lib/clients';
import { RequestDetails } from '../../../src/lib/types';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../helpers';
import constants from '../../../../relay/src/lib/constants';

chai.use(chaiAsPromised);

describe('LocalLRUCache Test Suite', async function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const callingMethod = 'localLRUCacheTest';
  const requestDetails = new RequestDetails({ requestId: 'localLRUCacheTest', ipAddress: '0.0.0.0' });

  let localLRUCache: LocalLRUCache;

  this.beforeAll(() => {
    localLRUCache = new LocalLRUCache(logger.child({ name: constants.LOGGER_CHILD_NAME.CACHE }), registry);
  });

  this.beforeEach(() => {
    localLRUCache.clear();
  });

  describe('verify simple cache', async function () {
    it('get on empty cache return null', async function () {
      const cacheValue = await localLRUCache.get('test', callingMethod, requestDetails);
      expect(cacheValue).to.be.null;
    });

    it('get on valid string cache returns non null', async function () {
      const key = 'key';
      const expectedValue = 'value';
      await localLRUCache.set(key, expectedValue, callingMethod, requestDetails);
      const cacheValue = await localLRUCache.get(key, callingMethod, requestDetails);
      expect(cacheValue).to.be.equal(expectedValue);
    });

    it('get on valid int cache returns non null', async function () {
      const key = 'key';
      const expectedValue = 1;
      await localLRUCache.set(key, expectedValue, callingMethod, requestDetails);
      const cacheValue = await localLRUCache.get(key, callingMethod, requestDetails);
      expect(cacheValue).to.be.equal(expectedValue);
    });

    it('get on valid false boolean cache returns non null', async function () {
      const key = 'key';
      const expectedValue = false;
      await localLRUCache.set(key, expectedValue, callingMethod, requestDetails);
      const cacheValue = await localLRUCache.get(key, callingMethod, requestDetails);
      expect(cacheValue).to.be.equal(expectedValue);
    });

    it('get on valid true boolean cache returns non null', async function () {
      const key = 'key';
      const expectedValue = true;
      await localLRUCache.set(key, expectedValue, callingMethod, requestDetails);
      const cacheValue = await localLRUCache.get(key, callingMethod, requestDetails);
      expect(cacheValue).to.be.equal(expectedValue);
    });

    it('get on valid object cache returns non null', async function () {
      const key = 'key';
      const expectedValue = { key: 'value' };
      await localLRUCache.set(key, expectedValue, callingMethod, requestDetails);
      const cacheValue = await localLRUCache.get(key, callingMethod, requestDetails);
      expect(cacheValue).to.be.equal(expectedValue);
    });

    it('delete a valid object', async function () {
      const key = 'key';
      const expectedValue = { key: 'value' };
      await localLRUCache.set(key, expectedValue, callingMethod, requestDetails);
      const cacheValueBeforeDelete = await localLRUCache.get(key, callingMethod, requestDetails);
      await localLRUCache.delete(key, callingMethod, requestDetails);

      const cacheValueAfterDelete = await localLRUCache.get(key, callingMethod, requestDetails);
      expect(cacheValueBeforeDelete).to.not.be.null;
      expect(cacheValueAfterDelete).to.be.null;
    });

    it('purge stale entries from the cache', async function () {
      expect(localLRUCache.purgeStale()).to.not.throw;
    });
  });

  describe('verify cache management', async function () {
    overrideEnvsInMochaDescribe({ CACHE_MAX: 2 });

    it('verify cache size', async function () {
      const customLocalLRUCache = new LocalLRUCache(logger.child({ name: constants.LOGGER_CHILD_NAME.CACHE }), registry);
      const keyValuePairs = {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      };

      Object.entries(keyValuePairs).forEach(([key, value]) => {
        customLocalLRUCache.set(key, value, callingMethod, requestDetails);
      });

      const key1 = await customLocalLRUCache.get('key1', callingMethod, requestDetails);
      const key2 = await customLocalLRUCache.get('key2', callingMethod, requestDetails);
      const key3 = await customLocalLRUCache.get('key3', callingMethod, requestDetails);
      // expect cache to have capped at max size
      expect(key1).to.be.null; // key1 should have been evicted
      expect(key2).to.be.equal(keyValuePairs.key2);
      expect(key3).to.be.equal(keyValuePairs.key3);
    });

    it('should not evict reserved keys from the cache on reaching the max cache size limit', async function () {
      const reservedKeys = ['key1', 'key2'];
      const customLocalLRUCache = new LocalLRUCache(logger.child({ name: constants.LOGGER_CHILD_NAME.CACHE }), registry, new Set(reservedKeys));
      const keyValuePairs = {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
        key4: 'value4',
        key5: 'value5',
      };

      for (const [key, value] of Object.entries(keyValuePairs)) {
        await customLocalLRUCache.set(key, value, callingMethod, requestDetails);
      }

      const key1 = await customLocalLRUCache.get('key1', callingMethod, requestDetails);
      const key2 = await customLocalLRUCache.get('key2', callingMethod, requestDetails);
      const key3 = await customLocalLRUCache.get('key3', callingMethod, requestDetails);
      const key4 = await customLocalLRUCache.get('key4', callingMethod, requestDetails);
      const key5 = await customLocalLRUCache.get('key5', callingMethod, requestDetails);
      // expect cache to have capped at max size
      expect(key1).to.be.equal(keyValuePairs.key1); // key1 should not have been evicted, as it is a reserved key
      expect(key2).to.be.equal(keyValuePairs.key2); // key2 should not have been evicted, as it is a reserved key
      expect(key3).to.be.null; // key3 should have been evicted
      expect(key4).to.be.equal(keyValuePairs.key4);
      expect(key5).to.be.equal(keyValuePairs.key5);

      const allKeys = await customLocalLRUCache.keys('*', callingMethod, requestDetails);
      expect(allKeys).to.have.members(['key1', 'key2', 'key4', 'key5']);
    });

    it('verify cache LRU nature', async function () {
      const customLocalLRUCache = new LocalLRUCache(logger.child({ name: constants.LOGGER_CHILD_NAME.CACHE }), registry);
      const key = 'key';
      let valueCount = 0; // keep track of values sets
      await customLocalLRUCache.set(key, ++valueCount, callingMethod, requestDetails);
      await customLocalLRUCache.set(key, ++valueCount, callingMethod, requestDetails);
      await customLocalLRUCache.set(key, ++valueCount, callingMethod, requestDetails);
      const cacheValue = await customLocalLRUCache.get(key, callingMethod, requestDetails);
      // expect cache to have the latest value for key
      expect(cacheValue).to.be.equal(valueCount);
    });

    it('verify cache ttl nature', async function () {
      const customLocalLRUCache = new LocalLRUCache(logger.child({ name: constants.LOGGER_CHILD_NAME.CACHE }), registry);
      const key = 'key';
      const ttl = 100; // set ttl to 100ms
      await customLocalLRUCache.set(key, 'value', callingMethod, requestDetails, ttl);
      await new Promise((r) => setTimeout(r, ttl + 100)); // wait for ttl to expire
      const cacheValue = await customLocalLRUCache.get(key, callingMethod, requestDetails);
      expect(cacheValue).to.be.null;
    });

    // set default cache ttl to 100ms to test the default ttl will be overridden by the ttl passed in set method
    withOverriddenEnvsInMochaTest({ CACHE_TTL: 100 }, async () => {
      it('it should set without TTL if -1 is passed for TTL', async () => {
        const customLocalLRUCache = new LocalLRUCache(logger.child({ name: constants.LOGGER_CHILD_NAME.CACHE }), registry);
        const lruCacheSpy = sinon.spy(customLocalLRUCache['cache']);

        const key = 'key';
        const value = { intField: 1, stringField: 'string', boolField: true, arrField: [1, 2, 3] };
        const ttl = -1;

        await customLocalLRUCache.set(key, value, callingMethod, requestDetails, ttl);
        sinon.assert.calledOnceWithExactly(lruCacheSpy.set, key, value, { ttl: 0 });

        const cachedValue = await customLocalLRUCache.get(key, callingMethod, requestDetails);
        expect(cachedValue).equal(value);

        await new Promise((resolve) => setTimeout(resolve, customLocalLRUCache['options'].ttl + 100));

        const cachedValueAfterTTL = await customLocalLRUCache.get(key, callingMethod, requestDetails);
        expect(cachedValueAfterTTL).equal(value);
      });
    });
  });

  describe('KEYS Test Suite', async function () {
    it('should retrieve keys matching a glob-style pattern with *', async function () {
      const keys = ['hello', 'hallo', 'hxllo'];
      for (let i = 0; i < keys.length; i++) {
        await localLRUCache.set(keys[i], `value${i}`, callingMethod, requestDetails);
      }
      await expect(localLRUCache.keys('h*llo', callingMethod, requestDetails)).to.eventually.have.members(keys);
    });

    it('should retrieve keys matching a glob-style pattern with ?', async function () {
      const keys = ['hello', 'hallo', 'hxllo'];
      for (let i = 0; i < keys.length; i++) {
        await localLRUCache.set(keys[i], `value${i}`, callingMethod, requestDetails);
      }
      await expect(localLRUCache.keys('h?llo', callingMethod, requestDetails)).to.eventually.have.members(keys);
    });

    it('should retrieve keys matching a glob-style pattern with []', async function () {
      const key1 = 'hello';
      const key2 = 'hallo';
      const pattern = 'h[ae]llo';

      await localLRUCache.set(key1, 'value1', callingMethod, requestDetails);
      await localLRUCache.set(key2, 'value2', callingMethod, requestDetails);

      const keys = await localLRUCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a glob-style pattern with [^]', async function () {
      const key1 = 'hallo';
      const key2 = 'hbllo';
      const pattern = 'h[^e]llo';

      await localLRUCache.set(key1, 'value1', callingMethod, requestDetails);
      await localLRUCache.set(key2, 'value2', callingMethod, requestDetails);

      const keys = await localLRUCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a glob-style pattern with [a-b]', async function () {
      const key1 = 'hallo';
      const key2 = 'hbllo';
      const pattern = 'h[a-b]llo';

      await localLRUCache.set(key1, 'value1', callingMethod, requestDetails);
      await localLRUCache.set(key2, 'value2', callingMethod, requestDetails);

      const keys = await localLRUCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a pattern with escaped special characters', async function () {
      const keys = ['h*llo', 'h?llo', 'h[llo', 'h]llo'];
      for (let i = 0; i < keys.length; i++) {
        await localLRUCache.set(keys[i], `value${i}`, callingMethod, requestDetails);
      }
      for (const key of keys) {
        await expect(
          localLRUCache.keys(key.replace(/([*?[\]])/g, '\\$1'), callingMethod, requestDetails),
        ).eventually.has.members([key]);
      }
    });

    it('should retrieve all keys with * pattern', async function () {
      const key1 = 'firstname';
      const key2 = 'lastname';
      const key3 = 'age';
      const pattern = '*';

      await localLRUCache.set(key1, 'Jack', callingMethod, requestDetails);
      await localLRUCache.set(key2, 'Stuntman', callingMethod, requestDetails);
      await localLRUCache.set(key3, '35', callingMethod, requestDetails);

      const keys = await localLRUCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2, key3]);
    });

    it('should be able to multiSet', async function () {
      await localLRUCache.multiSet(
        {
          boolean: false,
          number: 5644,
        },
        callingMethod,
        requestDetails,
      );

      expect(await localLRUCache.get('boolean', callingMethod, requestDetails)).to.be.false;
      expect(await localLRUCache.get('number', callingMethod, requestDetails)).to.equal(5644);
    });
  });
});
