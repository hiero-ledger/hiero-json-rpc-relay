// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';

import { LocalTransactionTimestampIndex } from '../../../../../src/relay/lib/services/transactionTimestampIndexService/LocalTransactionTimestampIndex';

chai.use(chaiAsPromised);

describe('LocalTransactionTimestampIndex Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const TTL_MS = 300000;
  const MAX_ENTRIES = 10;

  const hashOf = (n: number): string => '0x' + n.toString(16).padStart(64, '0');
  const HASH = hashOf(1);

  const TIMESTAMP = '1786958468.715212954';

  describe('entry storage', () => {
    let index: LocalTransactionTimestampIndex;

    beforeEach(() => {
      index = new LocalTransactionTimestampIndex(logger, TTL_MS, MAX_ENTRIES);
    });

    it('stores and retrieves a consensus timestamp by hash', async () => {
      await index.setMany([[HASH, TIMESTAMP]]);

      expect(await index.get(HASH)).to.equal(TIMESTAMP);
    });

    it('returns null for a missing hash', async () => {
      expect(await index.get(HASH)).to.be.null;
    });

    it('preserves the nanosecond precision of the stored timestamp verbatim', async () => {
      await index.setMany([[HASH, TIMESTAMP]]);

      const result = await index.get(HASH);
      expect(result).to.equal(TIMESTAMP);
      expect(result).to.be.a('string');
    });

    it('writes every entry of a batch', async () => {
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

    it('accepts an empty batch without writing anything', async () => {
      await index.setMany([]);

      expect(await index.get(HASH)).to.be.null;
    });
  });

  describe('TTL handling', () => {
    it('expires an entry once its TTL elapses', async () => {
      const index = new LocalTransactionTimestampIndex(logger, 50, MAX_ENTRIES);
      await index.setMany([[HASH, TIMESTAMP]]);
      expect(await index.get(HASH)).to.equal(TIMESTAMP);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await index.get(HASH)).to.be.null;
    });

    it('retains an entry indefinitely when the TTL is eternal (0)', async () => {
      const index = new LocalTransactionTimestampIndex(logger, 0, MAX_ENTRIES);
      await index.setMany([[HASH, TIMESTAMP]]);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await index.get(HASH)).to.equal(TIMESTAMP);
    });

    it('retains an entry indefinitely when the TTL is eternal (-1)', async () => {
      const index = new LocalTransactionTimestampIndex(logger, -1, MAX_ENTRIES);
      await index.setMany([[HASH, TIMESTAMP]]);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await index.get(HASH)).to.equal(TIMESTAMP);
    });
  });

  describe('entry bound', () => {
    it('retains entries up to the bound it was constructed with', async () => {
      const index = new LocalTransactionTimestampIndex(logger, TTL_MS, 3);

      await index.setMany([1, 2, 3].map((i) => [hashOf(i), `${i}.000000001`] as const));

      for (const i of [1, 2, 3]) {
        expect(await index.get(hashOf(i)), `entry ${i} should be retained`).to.equal(`${i}.000000001`);
      }
    });

    it('evicts the least recently used entry once the bound is exceeded', async () => {
      const index = new LocalTransactionTimestampIndex(logger, TTL_MS, 3);

      await index.setMany([1, 2, 3, 4].map((i) => [hashOf(i), `${i}.000000001`] as const));

      expect(await index.get(hashOf(1))).to.be.null;
      for (const i of [2, 3, 4]) {
        expect(await index.get(hashOf(i)), `entry ${i} should be retained`).to.equal(`${i}.000000001`);
      }
    });

    it('evicts within a single batch larger than the bound, keeping the most recent entries', async () => {
      const index = new LocalTransactionTimestampIndex(logger, TTL_MS, 2);

      await index.setMany([1, 2, 3, 4, 5].map((i) => [hashOf(i), `${i}.000000001`] as const));

      const retained = (
        await Promise.all([1, 2, 3, 4, 5].map(async (i) => ((await index.get(hashOf(i))) === null ? null : i)))
      ).filter((i) => i !== null);
      expect(retained).to.deep.equal([4, 5]);
    });
  });
});
