// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { createClient, type RedisClientType } from 'redis';

import constants from '../../../../../src/relay/lib/constants';
import { RedisTransactionTimestampIndex } from '../../../../../src/relay/lib/services/transactionTimestampIndexService/RedisTransactionTimestampIndex';
import { useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('RedisTransactionTimestampIndex Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const TTL_MS = 300000;

  let redisClient: RedisClientType;
  let index: RedisTransactionTimestampIndex;

  useInMemoryRedisServer(logger, 6392);

  const hashOf = (n: number): string => '0x' + n.toString(16).padStart(64, '0');
  const HASH = hashOf(1);
  const TIMESTAMP = '1786958468.715212954';

  before(async () => {
    redisClient = createClient({ url: 'redis://127.0.0.1:6392' });
    await redisClient.connect();
    redisClient.on('error', (err: any) => {
      const message: string = err?.message ?? '';
      if (message.includes('Socket closed') || message.includes('The client is closed')) {
        return;
      }
      throw err;
    });
    index = new RedisTransactionTimestampIndex(redisClient, TTL_MS);
  });

  beforeEach(async () => {
    await redisClient.flushAll();
  });

  it('stores and retrieves a consensus timestamp by hash', async () => {
    await index.setMany([[HASH, TIMESTAMP]]);

    expect(await index.get(HASH)).to.equal(TIMESTAMP);
  });

  it('returns null for a missing hash', async () => {
    expect(await index.get(HASH)).to.be.null;
  });

  it('writes a whole batch', async () => {
    await index.setMany([
      [hashOf(1), '1786958468.715212954'],
      [hashOf(2), '1786958469.000000001'],
      [hashOf(3), '1786958470.123456789'],
    ]);

    expect(await index.get(hashOf(1))).to.equal('1786958468.715212954');
    expect(await index.get(hashOf(2))).to.equal('1786958469.000000001');
    expect(await index.get(hashOf(3))).to.equal('1786958470.123456789');
  });

  it('overwrites an existing hash (last-write-wins)', async () => {
    await index.setMany([[HASH, '1786958468.715212954']]);
    await index.setMany([[HASH, '1786958469.000000001']]);

    expect(await index.get(HASH)).to.equal('1786958469.000000001');
  });

  it('stores entries under the shared key prefix', async () => {
    await index.setMany([[HASH, TIMESTAMP]]);

    expect(await redisClient.get(constants.TX_TIMESTAMP_INDEX_KEY_PREFIX + HASH)).to.equal(TIMESTAMP);
  });

  it('issues no command for an empty batch', async () => {
    await index.setMany([]);

    expect(await redisClient.dbSize()).to.equal(0);
  });

  it('applies a TTL (EXPIRE) to stored keys when TTL is finite', async () => {
    await index.setMany([[HASH, TIMESTAMP]]);

    const ttl = await redisClient.ttl(constants.TX_TIMESTAMP_INDEX_KEY_PREFIX + HASH);
    expect(ttl).to.be.greaterThan(0);
    expect(ttl).to.be.at.most(TTL_MS / 1000);
  });

  it('persists indefinitely (no EXPIRE) when TTL is eternal (0)', async () => {
    const eternalIndex = new RedisTransactionTimestampIndex(redisClient, 0);
    await eternalIndex.setMany([[HASH, TIMESTAMP]]);

    // redis returns -1 for a key with no associated expire
    expect(await redisClient.ttl(constants.TX_TIMESTAMP_INDEX_KEY_PREFIX + HASH)).to.equal(-1);
  });

  it('persists indefinitely (no EXPIRE) when TTL is eternal (-1)', async () => {
    const eternalIndex = new RedisTransactionTimestampIndex(redisClient, -1);
    await eternalIndex.setMany([[HASH, TIMESTAMP]]);

    expect(await redisClient.ttl(constants.TX_TIMESTAMP_INDEX_KEY_PREFIX + HASH)).to.equal(-1);
  });

  it('applies the TTL to every entry of a batch', async () => {
    await index.setMany([
      [hashOf(1), '1.000000001'],
      [hashOf(2), '2.000000002'],
    ]);

    for (const i of [1, 2]) {
      const ttl = await redisClient.ttl(constants.TX_TIMESTAMP_INDEX_KEY_PREFIX + hashOf(i));
      expect(ttl, `entry ${i} should carry a TTL`).to.be.greaterThan(0);
    }
  });

  after(async () => {
    if (redisClient?.isOpen) {
      await redisClient.disconnect();
    }
  });
});
