// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';

chai.use(chaiAsPromised);

import { ConfigService } from '../../../src/config-service/services';
import { predefined } from '../../../src/relay';
import { AdminImpl } from '../../../src/relay/lib/admin';
import { TransactionTracingService, TransactionTracingStorageFactory } from '../../../src/relay/lib/services';
import { withOverriddenEnvsInMochaTest } from '../helpers';

const logger = pino({ level: 'silent' });

const HASH = '0x' + 'c'.repeat(64);

describe('AdminImpl transaction trace methods', function () {
  const buildAdmin = (): { admin: AdminImpl; tracing: TransactionTracingService } => {
    const storage = TransactionTracingService.isEnabled()
      ? TransactionTracingStorageFactory.create(logger, ConfigService.get('TX_STATUS_TRACING_TTL_MS'))
      : undefined;
    const tracing = new TransactionTracingService(logger, storage);
    const admin = new AdminImpl({} as any, tracing);
    return { admin, tracing };
  };

  describe('when TX_STATUS_TRACING is disabled', function () {
    it('getTransactionTraceByHash throws UNSUPPORTED_METHOD', async () => {
      const { admin } = buildAdmin();
      await expect(admin.getTransactionTraceByHash(HASH)).to.be.rejectedWith(predefined.UNSUPPORTED_METHOD.message);
    });
  });

  withOverriddenEnvsInMochaTest({ TX_STATUS_TRACING: true }, function () {
    it('returns a recorded trace by hash', async () => {
      const { admin, tracing } = buildAdmin();
      await tracing.recordRejected(HASH, { error: 'boom', hederaStatus: 'WRONG_NONCE' });

      const record = await admin.getTransactionTraceByHash(HASH);
      expect(record).to.not.be.null;
      expect(record!.status).to.equal('rejected');
      expect(record!.hederaStatus).to.equal('WRONG_NONCE');
    });

    it('returns null for an unknown hash', async () => {
      const { admin } = buildAdmin();
      expect(await admin.getTransactionTraceByHash(HASH)).to.be.null;
    });
  });

  withOverriddenEnvsInMochaTest({ TX_STATUS_TRACING: true, DISABLE_ADMIN_NAMESPACE: true }, function () {
    it('throws UNSUPPORTED_METHOD when the admin namespace is disabled', async () => {
      const { admin } = buildAdmin();
      await expect(admin.getTransactionTraceByHash(HASH)).to.be.rejectedWith(predefined.UNSUPPORTED_METHOD.message);
    });
  });
});
