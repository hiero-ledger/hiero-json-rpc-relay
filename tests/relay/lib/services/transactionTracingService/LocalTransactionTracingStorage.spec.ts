// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';

import { LocalTransactionTracingStorage } from '../../../../../src/relay/lib/services/transactionTracingService/LocalTransactionTracingStorage';
import { type TransactionTraceRecord } from '../../../../../src/relay/lib/types/transactionTracing';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

chai.use(chaiAsPromised);

describe('LocalTransactionTracingStorage Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const TTL_MS = 900000;
  const TX_ID = '0.0.1234@1700000000.000000001';

  const hashOf = (n: number): string => '0x' + n.toString(16).padStart(64, '0');
  const HASH = hashOf(1);

  describe('record storage', () => {
    let storage: LocalTransactionTracingStorage;

    beforeEach(() => {
      storage = new LocalTransactionTracingStorage(logger, TTL_MS);
    });

    it('stores and retrieves a record by hash', async () => {
      const record: TransactionTraceRecord = { status: 'pending', timestamp: 1 };
      await storage.set(HASH, record);

      expect(await storage.get(HASH)).to.deep.equal(record);
    });

    it('returns null for a missing hash', async () => {
      expect(await storage.get(HASH)).to.be.null;
    });

    it('overwrites an existing record by key (last-write-wins)', async () => {
      await storage.set(HASH, { status: 'sent', timestamp: 1, transactionId: TX_ID });
      await storage.set(HASH, { status: 'validated', timestamp: 2, transactionId: TX_ID });

      const result = await storage.get(HASH);
      expect(result!.status).to.equal('validated');
      expect(result!.transactionId).to.equal(TX_ID);
    });

    it('keeps records for distinct hashes independent', async () => {
      await storage.set(hashOf(1), { status: 'rejected', timestamp: 1, hederaStatus: 'WRONG_NONCE' });
      await storage.set(hashOf(2), { status: 'sent', timestamp: 2 });

      expect((await storage.get(hashOf(1)))!.status).to.equal('rejected');
      expect((await storage.get(hashOf(2)))!.status).to.equal('sent');
    });
  });

  describe('TTL handling', () => {
    it('expires a record once its TTL elapses', async () => {
      const storage = new LocalTransactionTracingStorage(logger, 50);
      await storage.set(HASH, { status: 'pending', timestamp: 1 });
      expect(await storage.get(HASH)).to.not.be.null;

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await storage.get(HASH)).to.be.null;
    });

    it('retains a record indefinitely when the TTL is eternal (0)', async () => {
      const storage = new LocalTransactionTracingStorage(logger, 0);
      await storage.set(HASH, { status: 'pending', timestamp: 1 });

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(await storage.get(HASH)).to.not.be.null;
    });
  });

  describe('entry bound', () => {
    // A shared CACHE_MAX far below the tracing bound: trace records must not be sized by it.
    overrideEnvsInMochaDescribe({ CACHE_MAX: 1, TX_STATUS_TRACING_MAX_ENTRIES: 3 });

    it('is bounded by TX_STATUS_TRACING_MAX_ENTRIES, not by the shared CACHE_MAX', async () => {
      const storage = new LocalTransactionTracingStorage(logger, TTL_MS);

      for (let i = 1; i <= 3; i++) {
        await storage.set(hashOf(i), { status: 'rejected', timestamp: i });
      }

      for (let i = 1; i <= 3; i++) {
        expect(await storage.get(hashOf(i)), `record ${i} should be retained`).to.not.be.null;
      }
    });

    it('evicts the least recently used record once the bound is exceeded', async () => {
      const storage = new LocalTransactionTracingStorage(logger, TTL_MS);

      for (let i = 1; i <= 4; i++) {
        await storage.set(hashOf(i), { status: 'rejected', timestamp: i });
      }

      expect(await storage.get(hashOf(1))).to.be.null;
      for (let i = 2; i <= 4; i++) {
        expect(await storage.get(hashOf(i)), `record ${i} should be retained`).to.not.be.null;
      }
    });
  });
});
