// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { Registry } from 'prom-client';
import { RedisClientType } from 'redis';
import sinon from 'sinon';

import { RequestDetails } from '../../../dist/lib/types';
import { RedisCache } from '../../../src/lib/clients';
import { useInMemoryRedisServer } from '../../helpers';

chai.use(chaiAsPromised);

describe('RedisCache Test Suite', async function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const callingMethod = 'RedisCacheTest';
  const requestDetails = new RequestDetails({ requestId: 'localLRUCacheTest', ipAddress: '0.0.0.0' });

  let redisCache: RedisCache;
  let redisClientSpy: sinon.SinonSpiedInstance<RedisClientType>;

  useInMemoryRedisServer(logger, 6379);

  this.beforeAll(async () => {
    redisCache = new RedisCache(logger.child({ name: `cache` }), registry);
    redisCache['options'].ttl = 100; // set default cache ttl to 100ms for testing
    redisClientSpy = sinon.spy(redisCache['client']);
  });

  this.beforeEach(async () => {
    if (!(await redisCache.isConnected())) {
      await redisCache.connect();
    }
    await redisCache.clear();
    sinon.resetHistory();
  });

  this.afterAll(async () => {
    if (await redisCache.isConnected()) {
      await redisCache.disconnect();
    }
  });

  describe('Get and Set Test Suite', async function () {
    it('should get null on empty cache', async function () {
      const cacheValue = await redisCache.get('test', callingMethod, requestDetails);
      expect(cacheValue).to.be.null;
    });

    it('should get valid int cache', async function () {
      const key = 'int';
      const value = 1;

      await redisCache.set(key, value, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).equal(value);
    });

    it('should get valid boolean cache', async function () {
      const key = 'boolean';
      const value = false;

      await redisCache.set(key, value, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).equal(value);
    });

    it('should get valid array cache', async function () {
      const key = 'array';
      const value = ['false'];

      await redisCache.set(key, value, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).deep.equal(value);
    });

    it('should get valid object cache', async function () {
      const key = 'object';
      const value = { result: true };

      await redisCache.set(key, value, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).deep.equal(value);
    });

    it('should be able to set cache with TTL less than 1000 milliseconds', async () => {
      const key = 'int';
      const value = 1;
      const ttl = 100;

      await redisCache.set(key, value, callingMethod, requestDetails, ttl);
      sinon.assert.calledOnceWithExactly(redisClientSpy.set, key, JSON.stringify(value), { PX: ttl });

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).equal(value);

      await new Promise((resolve) => setTimeout(resolve, ttl + 100));

      const expiredValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(expiredValue).to.be.null;
    });

    it('should be able to set cache with TTL greater than 1000 milliseconds', async () => {
      const key = 'int';
      const value = 1;
      const ttl = 1100;

      await redisCache.set(key, value, callingMethod, requestDetails, ttl);
      sinon.assert.calledOnceWithExactly(redisClientSpy.set, key, JSON.stringify(value), { PX: ttl });

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).equal(value);

      await new Promise((resolve) => setTimeout(resolve, ttl + 100));

      const expiredValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(expiredValue).to.be.null;
    });

    it('it should set without TTL if -1 is passed for TTL', async () => {
      const key = 'int';
      const value = 1;
      const ttl = -1;

      await redisCache.set(key, value, callingMethod, requestDetails, ttl);
      sinon.assert.calledOnceWithExactly(redisClientSpy.set, key, JSON.stringify(value));

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).equal(value);

      await new Promise((resolve) => setTimeout(resolve, redisCache['options'].ttl));
    });
  });

  describe('MultiSet Test Suite', async function () {
    it('should set multiple key-value pairs in cache', async function () {
      const keyValuePairs = {
        int: 1,
        string: 'test',
        boolean: false,
        array: ['false'],
        object: { result: true },
      };

      await redisCache.multiSet(keyValuePairs, callingMethod, requestDetails);

      for (const key in keyValuePairs) {
        const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
        expect(cachedValue).deep.equal(keyValuePairs[key]);
      }
    });
  });

  describe('PipelineSet Test Suite', async function () {
    it('should set multiple key-value pairs in cache', async function () {
      const keyValuePairs = {
        int: 1,
        string: 'test',
        boolean: false,
        array: ['false'],
        object: { result: true },
      };

      await redisCache.pipelineSet(keyValuePairs, callingMethod, requestDetails);

      for (const key in keyValuePairs) {
        const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
        expect(cachedValue).deep.equal(keyValuePairs[key]);
      }
    });

    it('should set multiple key-value pairs in cache with TTL', async function () {
      const keyValuePairs = {
        int: 1,
        string: 'test',
        boolean: false,
        array: ['false'],
        object: { result: true },
      };

      await redisCache.pipelineSet(keyValuePairs, callingMethod, requestDetails, 500);

      for (const key in keyValuePairs) {
        const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
        expect(cachedValue).deep.equal(keyValuePairs[key]);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      for (const key in keyValuePairs) {
        const expiredValue = await redisCache.get(key, callingMethod, requestDetails);
        expect(expiredValue).to.be.null;
      }
    });
  });

  describe('Delete Test Suite', async function () {
    it('should delete int cache', async function () {
      const key = 'int';
      const value = 1;

      await redisCache.set(key, value, callingMethod, requestDetails);
      await redisCache.delete(key, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).to.be.null;
    });

    it('should delete boolean cache', async function () {
      const key = 'boolean';
      const value = false;

      await redisCache.set(key, value, callingMethod, requestDetails);
      await redisCache.delete(key, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).to.be.null;
    });

    it('should delete array cache', async function () {
      const key = 'array';
      const value = ['false'];

      await redisCache.set(key, value, callingMethod, requestDetails);
      await redisCache.delete(key, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).to.be.null;
    });

    it('should delete object cache', async function () {
      const key = 'object';
      const value = { result: true };

      await redisCache.set(key, value, callingMethod, requestDetails);
      await redisCache.delete(key, callingMethod, requestDetails);

      const cachedValue = await redisCache.get(key, callingMethod, requestDetails);
      expect(cachedValue).to.be.null;
    });
  });

  describe('Increment Test Suite', async function () {
    it('should increment a non-existing key', async function () {
      const key = 'non-existing';
      const amount = 1;

      const newValue = await redisCache.incrBy(key, amount, callingMethod, requestDetails);
      expect(newValue).equal(amount);
    });

    it('should increment an existing key', async function () {
      const key = 'existing';
      const initialValue = 5;
      const amount = 3;

      await redisCache.set(key, initialValue, callingMethod, requestDetails);
      const newValue = await redisCache.incrBy(key, amount, callingMethod, requestDetails);
      expect(newValue).equal(initialValue + amount);
    });

    it('should increment with a negative value', async function () {
      const key = 'negative-increment';
      const initialValue = 5;
      const amount = -2;

      await redisCache.set(key, initialValue, callingMethod, requestDetails);
      const newValue = await redisCache.incrBy(key, amount, callingMethod, requestDetails);
      expect(newValue).equal(initialValue + amount);
    });
  });

  describe('RPUSH Test Suite', async function () {
    it('should push to a non-existing list', async function () {
      const key = 'non-existing-list';
      const value = 'item1';

      const length = await redisCache.rPush(key, value, callingMethod, requestDetails);
      expect(length).equal(1);

      const list = await redisCache.lRange(key, 0, -1, callingMethod, requestDetails);
      expect(list).deep.equal([value]);
    });

    it('should push to an existing list', async function () {
      const key = 'existing-list';
      const initialList = ['item1'];
      const newValue = 'item2';

      await redisCache.rPush(key, initialList[0], callingMethod, requestDetails);
      const length = await redisCache.rPush(key, newValue, callingMethod, requestDetails);
      expect(length).equal(2);

      const list = await redisCache.lRange(key, 0, -1, callingMethod, requestDetails);
      expect(list).deep.equal([...initialList, newValue]);
    });
  });

  describe('LRANGE Test Suite', async function () {
    it('should retrieve a range from a non-existing list', async function () {
      const key = 'non-existing-range';
      const start = 0;
      const end = 1;

      const list = await redisCache.lRange(key, start, end, callingMethod, requestDetails);
      expect(list).deep.equal([]);
    });

    it('should retrieve a range from an existing list', async function () {
      const key = 'existing-range';
      const list = ['item1', 'item2', 'item3'];

      for (const item of list) {
        await redisCache.rPush(key, item, callingMethod, requestDetails);
      }

      const range = await redisCache.lRange(key, 0, 1, callingMethod, requestDetails);
      expect(range).deep.equal(['item1', 'item2']);
    });
  });

  describe('KEYS Test Suite', async function () {
    it('should retrieve keys matching a glob-style pattern with *', async function () {
      const keys = ['hello', 'hallo', 'hxllo'];
      for (let i = 0; i < keys.length; i++) {
        await redisCache.set(keys[i], `value${i}`, callingMethod, requestDetails);
      }
      await expect(redisCache.keys('h*llo', callingMethod, requestDetails)).to.eventually.have.members(keys);
    });

    it('should retrieve keys matching a glob-style pattern with ?', async function () {
      const keys = ['hello', 'hallo', 'hxllo'];
      for (let i = 0; i < keys.length; i++) {
        await redisCache.set(keys[i], `value${i}`, callingMethod, requestDetails);
      }
      await expect(redisCache.keys('h?llo', callingMethod, requestDetails)).to.eventually.have.members(keys);
    });

    it('should retrieve keys matching a glob-style pattern with []', async function () {
      const key1 = 'hello';
      const key2 = 'hallo';
      const pattern = 'h[ae]llo';

      await redisCache.set(key1, 'value1', callingMethod, requestDetails);
      await redisCache.set(key2, 'value2', callingMethod, requestDetails);

      const keys = await redisCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a glob-style pattern with [^]', async function () {
      const key1 = 'hallo';
      const key2 = 'hbllo';
      const pattern = 'h[^e]llo';

      await redisCache.set(key1, 'value1', callingMethod, requestDetails);
      await redisCache.set(key2, 'value2', callingMethod, requestDetails);

      const keys = await redisCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a glob-style pattern with [a-b]', async function () {
      const key1 = 'hallo';
      const key2 = 'hbllo';
      const pattern = 'h[a-b]llo';

      await redisCache.set(key1, 'value1', callingMethod, requestDetails);
      await redisCache.set(key2, 'value2', callingMethod, requestDetails);

      const keys = await redisCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a pattern with escaped special characters', async function () {
      const keys = ['h*llo', 'h?llo', 'h[llo', 'h]llo'];
      for (let i = 0; i < keys.length; i++) {
        await redisCache.set(keys[i], `value${i}`, callingMethod, requestDetails);
      }
      for (const key of keys) {
        await expect(
          redisCache.keys(key.replace(/([*?[\]])/g, '\\$1'), callingMethod, requestDetails),
        ).eventually.has.members([key]);
      }
    });

    it('should retrieve all keys with * pattern', async function () {
      const key1 = 'firstname';
      const key2 = 'lastname';
      const key3 = 'age';
      const pattern = '*';

      await redisCache.set(key1, 'Jack', callingMethod, requestDetails);
      await redisCache.set(key2, 'Stuntman', callingMethod, requestDetails);
      await redisCache.set(key3, '35', callingMethod, requestDetails);

      const keys = await redisCache.keys(pattern, callingMethod, requestDetails);
      expect(keys).to.include.members([key1, key2, key3]);
    });
  });

  describe('Connect Test Suite', () => {
    it('should connect to the Redis cache', async () => {
      await redisCache.disconnect();
      await redisCache.connect();
      await expect(redisCache.isConnected()).to.eventually.be.true;
    });

    it('should throw an error when the client is already connected', async () => {
      await expect(redisCache.connect()).to.eventually.be.rejectedWith('Socket already opened');
      await expect(redisCache.isConnected()).to.eventually.be.true;
    });
  });

  describe('Is Connected Test Suite', () => {
    it('should return true when connected', async () => {
      await expect(redisCache.isConnected()).to.eventually.be.true;
    });

    it('should return false when disconnected', async () => {
      await redisCache.disconnect();
      await expect(redisCache.isConnected()).to.eventually.be.false;
    });
  });

  describe('Number of Connections Test Suite', () => {
    it('should return the number of connections', async () => {
      await expect(redisCache.getNumberOfConnections()).to.eventually.equal(1);
    });

    it('should throw an error when the client is closed', async () => {
      await redisCache.disconnect();
      await expect(redisCache.getNumberOfConnections()).to.eventually.be.rejectedWith('The client is closed');
    });
  });

  describe('Disconnect Test Suite', () => {
    it('should disconnect from the Redis cache', async () => {
      await redisCache.disconnect();
      await expect(redisCache.isConnected()).to.eventually.be.false;
    });

    it('should do nothing when already disconnected', async () => {
      await redisCache.disconnect();
      await expect(redisCache.disconnect()).to.eventually.be.rejectedWith('The client is closed');
      await expect(redisCache.isConnected()).to.eventually.be.false;
    });
  });
});
