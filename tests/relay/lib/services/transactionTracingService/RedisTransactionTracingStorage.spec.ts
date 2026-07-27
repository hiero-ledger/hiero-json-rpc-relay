// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { createClient, type RedisClientType } from 'redis';

import { RedisTransactionTracingStorage } from '../../../../../src/relay/lib/services/transactionTracingService/RedisTransactionTracingStorage';
import { type TransactionTraceRecord } from '../../../../../src/relay/lib/types/transactionTracing';
import { useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('RedisTransactionTracingStorage Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });

  let redisClient: RedisClientType;
  let storage: RedisTransactionTracingStorage;

  useInMemoryRedisServer(logger, 6391);

  const HASH = '0x' + 'a'.repeat(64);
  const TX_ID = '0.0.1234@1700000000.000000001';

  before(async () => {
    redisClient = createClient({ url: 'redis://127.0.0.1:6391' });
    await redisClient.connect();
    redisClient.on('error', (err: any) => {
      const message: string = err?.message ?? '';
      if (message.includes('Socket closed') || message.includes('The client is closed')) {
        return;
      }
      throw err;
    });
    storage = new RedisTransactionTracingStorage(redisClient, 900000);
  });

  beforeEach(async () => {
    await redisClient.flushAll();
  });

  it('stores and retrieves a record by hash', async () => {
    const record: TransactionTraceRecord = { status: 'pending', timestamp: 1 };
    await storage.set(HASH, record);

    const result = await storage.get(HASH);
    expect(result).to.deep.equal(record);
  });

  it('returns null for a missing hash', async () => {
    expect(await storage.get(HASH)).to.be.null;
  });

  it('overwrites an existing record by key (last-write-wins)', async () => {
    await storage.set(HASH, { status: 'sent', timestamp: 1, transactionId: TX_ID });
    await storage.set(HASH, { status: 'validated', timestamp: 2, transactionId: TX_ID });

    const result = await storage.get(HASH);
    expect(result!.status).to.equal('validated');
  });

  it('deletes a record', async () => {
    await storage.set(HASH, { status: 'sent', timestamp: 1, transactionId: TX_ID });
    await storage.delete(HASH);

    expect(await storage.get(HASH)).to.be.null;
  });

  it('applies a TTL (EXPIRE) to stored keys when TTL is finite', async () => {
    await storage.set(HASH, { status: 'pending', timestamp: 1 });
    const ttl = await redisClient.ttl('txstatustrace:hash:' + HASH);
    expect(ttl).to.be.greaterThan(0);
  });

  it('persists indefinitely (no EXPIRE) when TTL is eternal (0)', async () => {
    const eternalStorage = new RedisTransactionTracingStorage(redisClient, 0);
    await eternalStorage.set(HASH, { status: 'pending', timestamp: 1 });
    const ttl = await redisClient.ttl('txstatustrace:hash:' + HASH);
    // redis returns -1 for a key with no associated expire
    expect(ttl).to.equal(-1);
  });
});
