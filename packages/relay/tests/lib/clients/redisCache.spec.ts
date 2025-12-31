// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RedisClientType } from 'redis';
import sinon from 'sinon';

import { RedisCache } from '../../../src/lib/clients';
import { RedisClientManager } from '../../../src/lib/clients/redisClientManager';
import { useInMemoryRedisServer } from '../../helpers';

chai.use(chaiAsPromised);

describe('RedisCache Test Suite', async function () {
  this.timeout(10000);

  const mockLogger = {
    child: sinon.stub().returnsThis(),
    trace: sinon.stub(),
    info: sinon.stub(),
    isLevelEnabled: sinon.stub().returns(true),
  };
  const callingMethod = 'RedisCacheTest';

  let redisCache: RedisCache;
  let redisClient: RedisClientType;

  const logger = mockLogger.child({ name: 'mock' });

  useInMemoryRedisServer(logger, 6379);

  this.beforeAll(async () => {
    redisClient = await RedisClientManager.getClient(logger);
    redisCache = new RedisCache(logger.child({ name: `cache` }), redisClient);
    redisCache['options'].ttl = 100;
    sinon.spy(redisClient, 'set');
  });

  this.beforeEach(async () => {
    logger.info('before each');
    if (!(await RedisClientManager.isConnected())) {
      await RedisClientManager.connect();
    }
    await redisCache.clear();
    sinon.resetHistory();
  });

  this.afterAll(async () => {
    if (await RedisClientManager.isConnected()) {
      await RedisClientManager.disconnect();
    }
  });

  describe('Get and Set Test Suite', async function () {
    it('should get null on empty cache', async function () {
      const cacheValue = await redisCache.get('test', callingMethod);
      expect(cacheValue).to.be.null;
    });

    it('should get valid int cache', async function () {
      const key = 'int';
      const value = 1;

      await redisCache.set(key, value, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).equal(value);
    });

    it('should get valid boolean cache', async function () {
      const key = 'boolean';
      const value = false;

      await redisCache.set(key, value, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).equal(value);
    });

    it('should get valid array cache', async function () {
      const key = 'array';
      const value = ['false'];

      await redisCache.set(key, value, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).deep.equal(value);
    });

    it('should get valid object cache', async function () {
      const key = 'object';
      const value = { result: true };

      await redisCache.set(key, value, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).deep.equal(value);
    });

    it('should be able to set cache with TTL less than 1000 milliseconds', async () => {
      const key = 'int';
      const value = 1;
      const ttl = 100;

      await redisCache.set(key, value, callingMethod, ttl);
      sinon.assert.calledOnceWithExactly(redisClient.set as sinon.SinonSpy, `cache:${key}`, JSON.stringify(value), {
        PX: ttl,
      });

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).equal(value);

      await new Promise((resolve) => setTimeout(resolve, ttl + 100));

      const expiredValue = await redisCache.get(key, callingMethod);
      expect(expiredValue).to.be.null;
    });

    it('should be able to set cache with TTL greater than 1000 milliseconds', async () => {
      const key = 'int';
      const value = 1;
      const ttl = 1100;

      await redisCache.set(key, value, callingMethod, ttl);
      sinon.assert.calledOnceWithExactly(redisClient.set as sinon.SinonSpy, `cache:${key}`, JSON.stringify(value), {
        PX: ttl,
      });

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).equal(value);

      await new Promise((resolve) => setTimeout(resolve, ttl + 100));

      const expiredValue = await redisCache.get(key, callingMethod);
      expect(expiredValue).to.be.null;
    });

    it('it should set without TTL if -1 is passed for TTL', async () => {
      const key = 'int';
      const value = 1;
      const ttl = -1;

      await redisCache.set(key, value, callingMethod, ttl);
      sinon.assert.calledOnceWithExactly(redisClient.set as sinon.SinonSpy, `cache:${key}`, JSON.stringify(value));

      const cachedValue = await redisCache.get(key, callingMethod);
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

      await redisCache.multiSet(keyValuePairs, callingMethod);

      for (const key in keyValuePairs) {
        const cachedValue = await redisCache.get(key, callingMethod);
        expect(cachedValue).deep.equal(keyValuePairs[key]);
      }
    });

    it('should fallback to pipeline set when multiset disabled', async function () {
      const keyValuePairs = {
        int: 1,
        string: 'test',
        boolean: false,
        array: ['false'],
        object: { result: true },
      };
      redisCache['options'].multiSetEnabled = false;
      await redisCache.multiSet(keyValuePairs, callingMethod);

      for (const key in keyValuePairs) {
        const cachedValue = await redisCache.get(key, callingMethod);
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

      await redisCache.pipelineSet(keyValuePairs, callingMethod);

      for (const key in keyValuePairs) {
        const cachedValue = await redisCache.get(key, callingMethod);
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

      await redisCache.pipelineSet(keyValuePairs, callingMethod, 500);

      for (const key in keyValuePairs) {
        const cachedValue = await redisCache.get(key, callingMethod);
        expect(cachedValue).deep.equal(keyValuePairs[key]);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      for (const key in keyValuePairs) {
        const expiredValue = await redisCache.get(key, callingMethod);
        expect(expiredValue).to.be.null;
      }
    });
  });

  describe('Delete Test Suite', async function () {
    it('should delete int cache', async function () {
      const key = 'int';
      const value = 1;

      await redisCache.set(key, value, callingMethod);
      await redisCache.delete(key, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).to.be.null;
    });

    it('should delete boolean cache', async function () {
      const key = 'boolean';
      const value = false;

      await redisCache.set(key, value, callingMethod);
      await redisCache.delete(key, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).to.be.null;
    });

    it('should delete array cache', async function () {
      const key = 'array';
      const value = ['false'];

      await redisCache.set(key, value, callingMethod);
      await redisCache.delete(key, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).to.be.null;
    });

    it('should delete object cache', async function () {
      const key = 'object';
      const value = { result: true };

      await redisCache.set(key, value, callingMethod);
      await redisCache.delete(key, callingMethod);

      const cachedValue = await redisCache.get(key, callingMethod);
      expect(cachedValue).to.be.null;
    });
  });

  describe('Increment Test Suite', async function () {
    it('should increment a non-existing key', async function () {
      const key = 'non-existing';
      const amount = 1;

      const newValue = await redisCache.incrBy(key, amount, callingMethod);
      expect(newValue).equal(amount);
    });

    it('should increment an existing key', async function () {
      const key = 'existing';
      const initialValue = 5;
      const amount = 3;

      await redisCache.set(key, initialValue, callingMethod);
      const newValue = await redisCache.incrBy(key, amount, callingMethod);
      expect(newValue).equal(initialValue + amount);
    });

    it('should increment with a negative value', async function () {
      const key = 'negative-increment';
      const initialValue = 5;
      const amount = -2;

      await redisCache.set(key, initialValue, callingMethod);
      const newValue = await redisCache.incrBy(key, amount, callingMethod);
      expect(newValue).equal(initialValue + amount);
    });
  });

  describe('RPUSH Test Suite', async function () {
    it('should push to a non-existing list', async function () {
      const key = 'non-existing-list';
      const value = 'item1';

      const length = await redisCache.rPush(key, value, callingMethod);
      expect(length).equal(1);

      const list = await redisCache.lRange(key, 0, -1, callingMethod);
      expect(list).deep.equal([value]);
    });

    it('should push to an existing list', async function () {
      const key = 'existing-list';
      const initialList = ['item1'];
      const newValue = 'item2';

      await redisCache.rPush(key, initialList[0], callingMethod);
      const length = await redisCache.rPush(key, newValue, callingMethod);
      expect(length).equal(2);

      const list = await redisCache.lRange(key, 0, -1, callingMethod);
      expect(list).deep.equal([...initialList, newValue]);
    });
  });

  describe('LRANGE Test Suite', async function () {
    it('should retrieve a range from a non-existing list', async function () {
      const key = 'non-existing-range';
      const start = 0;
      const end = 1;

      const list = await redisCache.lRange(key, start, end, callingMethod);
      expect(list).deep.equal([]);
    });

    it('should retrieve a range from an existing list', async function () {
      const key = 'existing-range';
      const list = ['item1', 'item2', 'item3'];

      for (const item of list) {
        await redisCache.rPush(key, item, callingMethod);
      }

      const range = await redisCache.lRange(key, 0, 1, callingMethod);
      expect(range).deep.equal(['item1', 'item2']);
    });
  });

  describe('KEYS Test Suite', async function () {
    it('should retrieve keys matching a glob-style pattern with *', async function () {
      const keys = ['hello', 'hallo', 'hxllo'];
      for (let i = 0; i < keys.length; i++) {
        await redisCache.set(keys[i], `value${i}`, callingMethod);
      }
      await expect(redisCache.keys('h*llo', callingMethod)).to.eventually.have.members(keys);
    });

    it('should retrieve keys matching a glob-style pattern with ?', async function () {
      const keys = ['hello', 'hallo', 'hxllo'];
      for (let i = 0; i < keys.length; i++) {
        await redisCache.set(keys[i], `value${i}`, callingMethod);
      }
      await expect(redisCache.keys('h?llo', callingMethod)).to.eventually.have.members(keys);
    });

    it('should retrieve keys matching a glob-style pattern with []', async function () {
      const key1 = 'hello';
      const key2 = 'hallo';
      const pattern = 'h[ae]llo';

      await redisCache.set(key1, 'value1', callingMethod);
      await redisCache.set(key2, 'value2', callingMethod);

      const keys = await redisCache.keys(pattern, callingMethod);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a glob-style pattern with [^]', async function () {
      const key1 = 'hallo';
      const key2 = 'hbllo';
      const pattern = 'h[^e]llo';

      await redisCache.set(key1, 'value1', callingMethod);
      await redisCache.set(key2, 'value2', callingMethod);

      const keys = await redisCache.keys(pattern, callingMethod);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a glob-style pattern with [a-b]', async function () {
      const key1 = 'hallo';
      const key2 = 'hbllo';
      const pattern = 'h[a-b]llo';

      await redisCache.set(key1, 'value1', callingMethod);
      await redisCache.set(key2, 'value2', callingMethod);

      const keys = await redisCache.keys(pattern, callingMethod);
      expect(keys).to.include.members([key1, key2]);
    });

    it('should retrieve keys matching a pattern with escaped special characters', async function () {
      const keys = ['h*llo', 'h?llo', 'h[llo', 'h]llo'];
      for (let i = 0; i < keys.length; i++) {
        await redisCache.set(keys[i], `value${i}`, callingMethod);
      }
      for (const key of keys) {
        await expect(redisCache.keys(key.replace(/([*?[\]])/g, '\\$1'), callingMethod)).eventually.has.members([key]);
      }
    });

    it('should retrieve all keys with * pattern', async function () {
      const key1 = 'firstname';
      const key2 = 'lastname';
      const key3 = 'age';
      const pattern = '*';

      await redisCache.set(key1, 'Jack', callingMethod);
      await redisCache.set(key2, 'Stuntman', callingMethod);
      await redisCache.set(key3, '35', callingMethod);

      const keys = await redisCache.keys(pattern, callingMethod);
      expect(keys).to.include.members([key1, key2, key3]);
    });
  });

  describe('Connect Test Suite', () => {
    it('should connect to the Redis cache', async () => {
      await RedisClientManager.disconnect();
      await RedisClientManager.connect();
      await expect(RedisClientManager.isConnected()).to.be.true;
    });

    it('should throw an error when the client is already connected', async () => {
      await expect(RedisClientManager.connect()).to.eventually.be.rejectedWith('Socket already opened');
      await expect(RedisClientManager.isConnected()).to.be.true;
    });
  });

  describe('Is Connected Test Suite', () => {
    it('should return true when connected', async () => {
      await expect(RedisClientManager.isConnected()).to.be.true;
    });

    it('should return false when disconnected', async () => {
      await RedisClientManager.disconnect();
      await expect(RedisClientManager.isConnected()).to.be.false;
    });
  });

  describe('Number of Connections Test Suite', () => {
    it('should return the number of connections', async () => {
      await expect(RedisClientManager.getNumberOfConnections()).to.eventually.equal(1);
    });

    it('should throw an error when the client is closed', async () => {
      await RedisClientManager.disconnect();
      await expect(RedisClientManager.getNumberOfConnections()).to.eventually.be.rejectedWith('The client is closed');
    });
  });

  describe('Clear Test Suite', () => {
    it('should only clear cache:* keys and not other namespaces', async () => {
      // Add some cache keys
      await redisCache.set('eth_blockNumber', '123', callingMethod);
      await redisCache.set('eth_gasPrice', '456', callingMethod);

      // Add keys from other namespaces to simulate other services
      await redisClient.set('txpool:pending:0x123', 'pendingtx');
      await redisClient.set('txpool:queue:0x456', 'queuedtx');
      await redisClient.set('hbar-limit:0x789', 'limitdata');
      await redisClient.set('other:namespace:key', 'value');

      // Clear the cache
      await redisCache.clear();

      // Verify cache keys are gone
      const cacheValue1 = await redisCache.get('eth_blockNumber', callingMethod);
      const cacheValue2 = await redisCache.get('eth_gasPrice', callingMethod);
      expect(cacheValue1).to.be.null;
      expect(cacheValue2).to.be.null;

      // Verify other namespace keys are still present
      const pendingTx = await redisClient.get('txpool:pending:0x123');
      const queueTx = await redisClient.get('txpool:queue:0x456');
      const limitData = await redisClient.get('hbar-limit:0x789');
      const otherKey = await redisClient.get('other:namespace:key');

      expect(pendingTx).to.equal('pendingtx');
      expect(queueTx).to.equal('queuedtx');
      expect(limitData).to.equal('limitdata');
      expect(otherKey).to.equal('value');
    });
  });

  describe('Disconnect Test Suite', () => {
    it('should disconnect from the Redis cache', async () => {
      await RedisClientManager.disconnect();
      await expect(RedisClientManager.isConnected()).to.be.false;
    });

    it('should do nothing when already disconnected', async () => {
      await RedisClientManager.disconnect();
      await expect(RedisClientManager.disconnect()).to.eventually.be.rejectedWith('The client is closed');
      await expect(RedisClientManager.isConnected()).to.be.false;
    });
  });
});
