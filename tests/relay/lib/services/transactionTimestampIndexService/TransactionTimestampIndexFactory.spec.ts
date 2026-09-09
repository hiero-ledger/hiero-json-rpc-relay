// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { type RedisClientType } from 'redis';

import { LocalTransactionTimestampIndex } from '../../../../../src/relay/lib/services/transactionTimestampIndexService/LocalTransactionTimestampIndex';
import { RedisTransactionTimestampIndex } from '../../../../../src/relay/lib/services/transactionTimestampIndexService/RedisTransactionTimestampIndex';
import {
  DisabledTransactionTimestampIndex,
  TransactionTimestampIndexFactory,
} from '../../../../../src/relay/lib/services/transactionTimestampIndexService/TransactionTimestampIndexFactory';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

chai.use(chaiAsPromised);

describe('TransactionTimestampIndexFactory Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });

  const hashOf = (n: number): string => '0x' + n.toString(16).padStart(64, '0');
  const HASH = hashOf(1);
  const TIMESTAMP = '1786958468.715212954';

  // The factory only stores the client; no command is issued during construction.
  const fakeRedisClient = {} as RedisClientType;

  describe('when the index is enabled', () => {
    overrideEnvsInMochaDescribe({ TX_TIMESTAMP_INDEX_ENABLED: true });

    it('creates a local index when no redis client is supplied', () => {
      expect(TransactionTimestampIndexFactory.create(logger)).to.be.instanceOf(LocalTransactionTimestampIndex);
    });

    it('creates a redis-backed index when a client is supplied', () => {
      expect(TransactionTimestampIndexFactory.create(logger, fakeRedisClient)).to.be.instanceOf(
        RedisTransactionTimestampIndex,
      );
    });
  });

  describe('when the index is disabled', () => {
    overrideEnvsInMochaDescribe({ TX_TIMESTAMP_INDEX_ENABLED: false });

    it('creates a disabled index even when a redis client is supplied', () => {
      expect(TransactionTimestampIndexFactory.create(logger, fakeRedisClient)).to.be.instanceOf(
        DisabledTransactionTimestampIndex,
      );
    });

    it('drops writes and misses every lookup', async () => {
      const index = TransactionTimestampIndexFactory.create(logger);

      await index.setMany([[HASH, TIMESTAMP]]);

      expect(await index.get(HASH)).to.be.null;
    });
  });

  describe('entry bound sourcing', () => {
    // A shared CACHE_MAX far below our own bound: the index must be sized by its own entry, not by CACHE_MAX.
    overrideEnvsInMochaDescribe({
      TX_TIMESTAMP_INDEX_ENABLED: true,
      CACHE_MAX: 1,
      TX_TIMESTAMP_INDEX_MAX_ENTRIES: 3,
    });

    it('sizes the local index by TX_TIMESTAMP_INDEX_MAX_ENTRIES, not by the shared CACHE_MAX', async () => {
      const index = TransactionTimestampIndexFactory.create(logger);

      await index.setMany([1, 2, 3].map((i) => [hashOf(i), `${i}.000000001`] as const));

      for (const i of [1, 2, 3]) {
        expect(await index.get(hashOf(i)), `entry ${i} should be retained`).to.equal(`${i}.000000001`);
      }
    });
  });

  describe('TTL sourcing', () => {
    overrideEnvsInMochaDescribe({ TX_TIMESTAMP_INDEX_ENABLED: true, TX_TIMESTAMP_INDEX_TTL_MS: 50 });

    it('applies TX_TIMESTAMP_INDEX_TTL_MS to the local index it builds', async () => {
      const index = TransactionTimestampIndexFactory.create(logger);
      await index.setMany([[HASH, TIMESTAMP]]);
      expect(await index.get(HASH)).to.equal(TIMESTAMP);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await index.get(HASH)).to.be.null;
    });
  });
});
