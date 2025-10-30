// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { createClient, RedisClientType } from 'redis';

import { RedisPendingTransactionStorage } from '../../../../src/lib/services/transactionPoolService/RedisPendingTransactionStorage';
import { useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('RedisPendingTransactionStorage Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });

  let redisClient: RedisClientType;
  let storage: RedisPendingTransactionStorage;

  useInMemoryRedisServer(logger, 6390);

  before(async () => {
    redisClient = createClient({ url: 'redis://127.0.0.1:6390' });
    await redisClient.connect();
    storage = new RedisPendingTransactionStorage(redisClient);
  });

  beforeEach(async () => {
    await redisClient.flushAll();
  });

  const addr1 = '0x1111111111111111111111111111111111111111';
  const addr2 = '0x2222222222222222222222222222222222222222';
  const tx1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const tx2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const tx3 = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

  describe('addToList (Set-based)', () => {
    it('adds first transaction and returns size 1', async () => {
      await storage.addToList(addr1, tx1);
      const count = await storage.getList(addr1);
      expect(count).to.equal(1);
    });

    it('deduplicates the same transaction hash', async () => {
      await storage.addToList(addr1, tx1);
      await storage.addToList(addr1, tx1);
      const count = await storage.getList(addr1);
      expect(count).to.equal(1);
    });

    it('adds multiple distinct tx hashes and returns correct size', async () => {
      await storage.addToList(addr1, tx1);
      await storage.addToList(addr1, tx2);
      const count = await storage.getList(addr1);
      expect(count).to.equal(2);
    });
  });

  describe('getList (Set-based)', () => {
    it('returns 0 for empty/non-existent key', async () => {
      const count = await storage.getList(addr2);
      expect(count).to.equal(0);
    });

    it('returns size after multiple adds', async () => {
      await storage.addToList(addr1, tx1);
      await storage.addToList(addr1, tx2);
      const count = await storage.getList(addr1);
      expect(count).to.equal(2);
    });
  });

  describe('removeFromList (Set-based)', () => {
    it('removes existing tx and returns new size', async () => {
      await storage.addToList(addr1, tx1);
      await storage.addToList(addr1, tx2);
      await storage.removeFromList(addr1, tx1);
      const count = await storage.getList(addr1);
      expect(count).to.equal(1);
    });

    it('is idempotent when removing non-existent tx', async () => {
      await storage.addToList(addr1, tx1);
      await storage.removeFromList(addr1, tx2);
      const count = await storage.getList(addr1);
      expect(count).to.equal(1);
    });
  });

  describe('removeAll', () => {
    it('deletes all txpool:pending:* keys', async () => {
      await storage.addToList(addr1, tx1);
      await storage.addToList(addr1, tx2);
      await storage.addToList(addr2, tx3);

      await storage.removeAll();

      const c1 = await storage.getList(addr1);
      const c2 = await storage.getList(addr2);
      expect(c1).to.equal(0);
      expect(c2).to.equal(0);
    });

    it('should not delete keys from other namespaces (cache:, txpool:queue:)', async () => {
      // Add some txpool:pending keys
      await storage.addToList(addr1, tx1);
      await storage.addToList(addr2, tx2);

      // Add keys from other namespaces to simulate other services
      await redisClient.set('cache:eth_blockNumber', '123');
      await redisClient.set('cache:eth_gasPrice', '456');
      await redisClient.set('txpool:queue:someaddress', 'queuedtx');
      await redisClient.set('other:namespace:key', 'value');

      // Remove all txpool:pending keys
      await storage.removeAll();

      // Verify txpool:pending keys are gone
      const c1 = await storage.getList(addr1);
      const c2 = await storage.getList(addr2);
      expect(c1).to.equal(0);
      expect(c2).to.equal(0);

      // Verify other namespace keys are still present
      const cacheKey1 = await redisClient.get('cache:eth_blockNumber');
      const cacheKey2 = await redisClient.get('cache:eth_gasPrice');
      const queueKey = await redisClient.get('txpool:queue:someaddress');
      const otherKey = await redisClient.get('other:namespace:key');

      expect(cacheKey1).to.equal('123');
      expect(cacheKey2).to.equal('456');
      expect(queueKey).to.equal('queuedtx');
      expect(otherKey).to.equal('value');
    });

    after(async () => {
      await redisClient.quit();
    });
  });
});
