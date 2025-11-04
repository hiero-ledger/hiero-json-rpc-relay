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
    // Ignore benign shutdown noise when the in-memory Redis server closes
    // its socket during global teardown. We still surface any other errors.
    redisClient.on('error', (err: any) => {
      const message: string = err?.message ?? '';
      if (message.includes('Socket closed') || message.includes('The client is closed')) {
        return;
      }
      // Surface unexpected errors
      throw err;
    });
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
  const rlp1 = '0xf86c018502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';
  const rlp2 = '0xf86c028502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';
  const rlp3 = '0xf86c038502540be400825208947742d35cc6629c0532c262d2d73f4c8e1a1b7b7b780801ca0';

  describe('addToList (Set-based)', () => {
    it('adds first transaction and returns size 1', async () => {
      await storage.addToList(addr1, rlp1);
      const count = await storage.getList(addr1);
      expect(count).to.equal(1);
    });

    it('deduplicates the same transaction hash', async () => {
      await storage.addToList(addr1, rlp1);
      await storage.addToList(addr1, rlp1);
      const count = await storage.getList(addr1);
      expect(count).to.equal(1);
    });

    it('adds multiple distinct tx hashes and returns correct size', async () => {
      await storage.addToList(addr1, rlp1);
      await storage.addToList(addr1, rlp2);
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
      await storage.addToList(addr1, rlp1);
      await storage.addToList(addr1, rlp2);
      const count = await storage.getList(addr1);
      expect(count).to.equal(2);
    });
  });

  describe('removeFromList (Set-based)', () => {
    it('removes existing tx and returns new size', async () => {
      await storage.addToList(addr1, rlp1);
      await storage.addToList(addr1, rlp2);
      await storage.removeFromList(addr1, rlp1);
      const count = await storage.getList(addr1);
      expect(count).to.equal(1);
    });

    it('is idempotent when removing non-existent tx', async () => {
      await storage.addToList(addr1, rlp1);
      await storage.removeFromList(addr1, rlp2);
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
  });

  describe('Payload retrieval', () => {
    it('should save and retrieve payload atomically', async () => {
      await storage.addToList(addr1, rlp1);

      const count = await storage.getList(addr1);
      expect(count).to.equal(1);

      const payloads = await storage.getTransactionPayloads(addr1);
      expect(payloads).to.have.lengthOf(1);
      expect(payloads).to.include(rlp1);

      const allPayloads = await storage.getAllTransactionPayloads();
      expect(allPayloads).to.include(rlp1);
    });

    it('should remove payload when removed from list', async () => {
      await storage.addToList(addr1, rlp1);

      await storage.removeFromList(addr1, rlp1);

      const count = await storage.getList(addr1);
      expect(count).to.equal(0);

      const payloads = await storage.getTransactionPayloads(addr1);
      expect(payloads).to.be.empty;

      const allPayloads = await storage.getAllTransactionPayloads();
      expect(allPayloads).to.not.include(rlp1);
    });

    it('should handle multiple transactions with payloads', async () => {
      await storage.addToList(addr1, rlp1);
      await storage.addToList(addr1, rlp2);
      await storage.addToList(addr2, rlp3);

      const count1 = await storage.getList(addr1);
      const count2 = await storage.getList(addr2);
      expect(count1).to.equal(2);
      expect(count2).to.equal(1);

      const payloads1 = await storage.getTransactionPayloads(addr1);
      const payloads2 = await storage.getTransactionPayloads(addr2);
      expect(payloads1).to.have.lengthOf(2);
      expect(payloads1).to.include.members([rlp1, rlp2]);
      expect(payloads2).to.have.lengthOf(1);
      expect(payloads2[0]).to.equal(rlp3);
    });

    it('should retrieve payloads for specific address only', async () => {
      await storage.addToList(addr1, rlp1);
      await storage.addToList(addr1, rlp2);
      await storage.addToList(addr2, rlp3);

      const payloads = await storage.getTransactionPayloads(addr1);
      expect(payloads).to.have.lengthOf(2);
      expect(payloads).to.include.members([rlp1, rlp2]);
      expect(payloads).to.not.include(rlp3);
    });

    it('should return empty array for address with no transactions', async () => {
      const payloads = await storage.getTransactionPayloads(addr1);
      expect(payloads).to.be.an('array');
      expect(payloads).to.be.empty;
    });

    it('should get all transaction payloads across addresses', async () => {
      await storage.addToList(addr1, rlp1);
      await storage.addToList(addr2, rlp2);

      const allPayloads = await storage.getAllTransactionPayloads();
      expect(allPayloads).to.have.lengthOf(2);
      expect(allPayloads).to.include.members([rlp1, rlp2]);
    });
  });

  // Note: use disconnect() (no QUIT round-trip) to avoid hanging or
  // "Socket closed unexpectedly" when the in-memory Redis server is
  // shutting down in its own after-hook. This after() is declared after
  // useInMemoryRedisServer(...), so Mocha runs it first, ensuring the
  // client disconnects before the server stops.
  after(async () => {
    if (redisClient?.isOpen) {
      await redisClient.disconnect();
    }
  });
});
