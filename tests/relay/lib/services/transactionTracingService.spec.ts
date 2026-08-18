// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import sinon from 'sinon';

import { ConfigService } from '../../../../src/config-service/services';
import { JsonRpcError } from '../../../../src/relay/lib/errors/JsonRpcError';
import { TransactionTracingService, TransactionTracingStorageFactory } from '../../../../src/relay/lib/services';
import { type ITransactionTracingStorage } from '../../../../src/relay/lib/types/transactionTracing';
import { withOverriddenEnvsInMochaTest } from '../../helpers';

chai.use(chaiAsPromised);

const logger = pino({ level: 'silent' });

const HASH = '0x' + 'a'.repeat(64);
const HASH_UPPER = '0x' + 'A'.repeat(64);
const OTHER_HASH = '0x' + 'b'.repeat(64);
const TX_ID = '0.0.1234@1700000000.000000001';

// Mirrors the relay wiring: build backing storage from config, then inject it into the service.
const buildEnabledService = (): TransactionTracingService =>
  new TransactionTracingService(
    logger,
    TransactionTracingStorageFactory.create(logger, ConfigService.get('TX_STATUS_TRACING_TTL_MS')),
  );

describe('TransactionTracingService', function () {
  describe('when TX_STATUS_TRACING is disabled', function () {
    let service: TransactionTracingService;

    beforeEach(() => {
      service = new TransactionTracingService(logger);
    });

    it('records are no-ops and lookups return null', async () => {
      await service.recordPending(HASH);
      await service.recordSent(HASH, TX_ID);
      await service.recordRejected(HASH, { error: 'x' });
      await service.recordTimedout(HASH, { error: 'x' });
      await service.recordValidated(HASH);

      expect(await service.getByHash(HASH)).to.be.null;
      expect(await service.getReceiptFallbackError(HASH)).to.be.null;
    });
  });

  withOverriddenEnvsInMochaTest({ TX_STATUS_TRACING: true }, function () {
    let service: TransactionTracingService;

    beforeEach(() => {
      service = buildEnabledService();
    });

    it('records and retrieves the pending state by hash', async () => {
      await service.recordPending(HASH);

      const record = await service.getByHash(HASH);
      expect(record).to.not.be.null;
      expect(record!.status).to.equal('pending');
      expect(record!.timestamp).to.be.a('number');
      expect(record!.transactionId).to.be.undefined;
    });

    it('normalizes the hash key (case-insensitive lookup)', async () => {
      await service.recordPending(HASH_UPPER);
      const record = await service.getByHash(HASH);
      expect(record).to.not.be.null;
      expect(record!.status).to.equal('pending');
    });

    it('records the sent state with a transaction id', async () => {
      await service.recordSent(HASH, TX_ID);

      const byHash = await service.getByHash(HASH);
      expect(byHash!.status).to.equal('sent');
      expect(byHash!.transactionId).to.equal(TX_ID);
    });

    it('records the rejected state with error and hedera status', async () => {
      await service.recordRejected(HASH, { error: 'boom', hederaStatus: 'WRONG_NONCE', transactionId: TX_ID });

      const record = await service.getByHash(HASH);
      expect(record!.status).to.equal('rejected');
      expect(record!.error).to.equal('boom');
      expect(record!.hederaStatus).to.equal('WRONG_NONCE');
    });

    it('records the timedout state', async () => {
      await service.recordTimedout(HASH, { error: 'slow' });

      const record = await service.getByHash(HASH);
      expect(record!.status).to.equal('timedout');
      expect(record!.error).to.equal('slow');
    });

    it('only upgrades an existing record to validated, preserving the transaction id', async () => {
      await service.recordSent(HASH, TX_ID);
      await service.recordValidated(HASH);

      const record = await service.getByHash(HASH);
      expect(record!.status).to.equal('validated');
      expect(record!.transactionId).to.equal(TX_ID);
    });

    it('does not create a record on validated when none exists (no pollution)', async () => {
      await service.recordValidated(OTHER_HASH);
      expect(await service.getByHash(OTHER_HASH)).to.be.null;
    });

    it('is idempotent on validated - no redundant write once already validated', async () => {
      const storage = TransactionTracingStorageFactory.create(logger, ConfigService.get('TX_STATUS_TRACING_TTL_MS'));
      const setSpy = sinon.spy(storage, 'set');
      const svc = new TransactionTracingService(logger, storage);

      await svc.recordSent(HASH, TX_ID); // set #1
      await svc.recordValidated(HASH); // set #2: sent -> validated
      await svc.recordValidated(HASH); // already validated: no write

      expect(setSpy.callCount).to.equal(2);
      expect((await svc.getByHash(HASH))!.status).to.equal('validated');
      sinon.restore();
    });

    it('overwrites by key on resend (last-write-wins restarts the lifecycle)', async () => {
      await service.recordSent(HASH, TX_ID);
      await service.recordPending(HASH);

      const record = await service.getByHash(HASH);
      expect(record!.status).to.equal('pending');
    });

    describe('getReceiptFallbackError', function () {
      it('returns a -32003 error carrying txHash for a rejected record', async () => {
        await service.recordRejected(HASH, { error: 'boom', hederaStatus: 'WRONG_NONCE', transactionId: TX_ID });

        const error = await service.getReceiptFallbackError(HASH);
        expect(error).to.be.instanceOf(JsonRpcError);
        expect(error!.code).to.equal(-32003);
        const data = error!.data as any;
        expect(data.txHash).to.equal(HASH);
        expect(data.detail).to.equal('boom');
        expect(data.hederaStatus).to.equal('WRONG_NONCE');
        expect(data.transactionId).to.equal(TX_ID);
      });

      it('returns a provisional -32003 error for a timedout record', async () => {
        await service.recordTimedout(HASH, { error: 'slow' });

        const error = await service.getReceiptFallbackError(HASH);
        expect(error).to.be.instanceOf(JsonRpcError);
        expect(error!.code).to.equal(-32003);
        const data = error!.data as any;
        expect(data.txHash).to.equal(HASH);
        expect(data.provisional).to.be.true;
      });

      it('returns null for pending / sent / validated records', async () => {
        await service.recordPending(HASH);
        expect(await service.getReceiptFallbackError(HASH)).to.be.null;

        await service.recordSent(HASH, TX_ID);
        expect(await service.getReceiptFallbackError(HASH)).to.be.null;

        await service.recordValidated(HASH);
        expect(await service.getReceiptFallbackError(HASH)).to.be.null;
      });

      it('returns null when no record exists', async () => {
        expect(await service.getReceiptFallbackError(OTHER_HASH)).to.be.null;
      });
    });
  });

  describe('when the storage layer fails', function () {
    const storageError = new Error('storage unavailable');

    let errorLog: sinon.SinonSpy;
    let storage: { set: sinon.SinonStub; get: sinon.SinonStub };
    let service: TransactionTracingService;

    beforeEach(() => {
      const childLogger = pino({ level: 'silent' });
      errorLog = sinon.spy(childLogger, 'error');
      storage = { set: sinon.stub().resolves(), get: sinon.stub().resolves(null) };
      service = new TransactionTracingService(
        { child: () => childLogger } as unknown as pino.Logger,
        storage as unknown as ITransactionTracingStorage,
      );
    });

    afterEach(() => sinon.restore());

    it('swallows and logs a write failure on every record path', async () => {
      storage.set.rejects(storageError);

      await expect(service.recordPending(HASH)).to.be.fulfilled;
      await expect(service.recordSent(HASH, TX_ID)).to.be.fulfilled;
      await expect(service.recordRejected(HASH, { error: 'boom' })).to.be.fulfilled;
      await expect(service.recordTimedout(HASH, { error: 'slow' })).to.be.fulfilled;

      expect(errorLog.callCount).to.equal(4);
      expect(errorLog.alwaysCalledWith(storageError)).to.be.true;
    });

    it('swallows and logs a read failure on recordValidated', async () => {
      storage.get.rejects(storageError);

      await expect(service.recordValidated(HASH)).to.be.fulfilled;
      expect(errorLog.calledOnceWith(storageError)).to.be.true;
    });

    it('swallows and logs a write failure on recordValidated', async () => {
      storage.get.resolves({ status: 'sent', timestamp: 1, transactionId: TX_ID });
      storage.set.rejects(storageError);

      await expect(service.recordValidated(HASH)).to.be.fulfilled;
      expect(errorLog.calledOnceWith(storageError)).to.be.true;
    });

    it('preserves the default null receipt when the fallback read fails', async () => {
      storage.get.rejects(storageError);

      expect(await service.getReceiptFallbackError(HASH)).to.be.null;
      expect(errorLog.calledOnceWith(storageError)).to.be.true;
    });
  });
});
