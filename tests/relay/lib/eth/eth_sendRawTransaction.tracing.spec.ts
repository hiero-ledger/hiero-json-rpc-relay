// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hiero-ledger/sdk';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Transaction } from 'ethers/transaction';
import sinon from 'sinon';

import { ConfigService } from '../../../../src/config-service/services';
import { predefined } from '../../../../src/relay';
import { SDKClientError } from '../../../../src/relay/lib/errors/SDKClientError';
import { RequestDetails } from '../../../../src/relay/lib/types';
import { signTransaction, withOverriddenEnvsInMochaTest } from '../../helpers';
import { generateEthTestEnv } from './eth-helpers';

chai.use(chaiAsPromised);

/**
 * Integration coverage for the tracing record sites on the CN-submission path. Each test drives
 * sendRawTransactionProcessor directly with a stubbed submitTransaction so we exercise the exact
 * handleSubmissionError branch that records each state, without needing full Mirror Node mocking.
 */
describe('eth_sendRawTransaction transaction tracing', function () {
  const requestDetails = new RequestDetails({ requestId: 'sendRawTracing', ipAddress: '0.0.0.0' });
  const TX_ID = '0.0.1234@1700000000.000000001';
  const GAS_PRICE = 710000000000;

  const buildSignedTx = async (): Promise<{ parsedTx: Transaction; transactionBuffer: Buffer }> => {
    const signed = await signTransaction({
      chainId: Number(ConfigService.get('CHAIN_ID')),
      to: '0x' + '11'.repeat(20),
      value: 0,
      gasPrice: GAS_PRICE,
      gasLimit: 100000,
      nonce: 0,
    });
    return { parsedTx: Transaction.from(signed), transactionBuffer: Buffer.from(signed.replace(/^0x/, ''), 'hex') };
  };

  withOverriddenEnvsInMochaTest({ TX_STATUS_TRACING: true }, function () {
    afterEach(() => sinon.restore());

    it('traces a clean submission as sent with the transaction id', async () => {
      const { ethImpl, transactionTracingService } = generateEthTestEnv();
      const transactionService = ethImpl['transactionService'] as any;
      const { parsedTx, transactionBuffer } = await buildSignedTx();

      sinon.stub(transactionService, 'submitTransaction').resolves({ submittedTransactionId: TX_ID, error: null });

      await transactionService.sendRawTransactionProcessor(
        transactionBuffer,
        parsedTx,
        GAS_PRICE,
        undefined,
        requestDetails,
      );

      const record = await transactionTracingService.getByHash(parsedTx.hash!);
      expect(record).to.not.be.null;
      expect(record!.status).to.equal('sent');
      expect(record!.transactionId).to.equal(TX_ID);
    });

    // Regression guard for the post-hash "invisible failure" gap: a non-SDKClientError raised during
    // submission (e.g. the INTERNAL_ERROR on a malformed transaction id) must be traced so a client that
    // already holds the hash can discover the failure via the receipt fallback instead of polling forever.
    it('traces a non-SDK submission error as timedout (provisional) and surfaces it via the receipt fallback', async () => {
      const { ethImpl, transactionTracingService } = generateEthTestEnv();
      const transactionService = ethImpl['transactionService'] as any;
      const { parsedTx, transactionBuffer } = await buildSignedTx();

      sinon
        .stub(transactionService, 'submitTransaction')
        .resolves({ submittedTransactionId: '', error: predefined.INTERNAL_ERROR('boom') });

      await transactionService
        .sendRawTransactionProcessor(transactionBuffer, parsedTx, GAS_PRICE, undefined, requestDetails)
        .catch(() => undefined);

      const record = await transactionTracingService.getByHash(parsedTx.hash!);
      expect(record).to.not.be.null;
      expect(record!.status).to.equal('timedout');

      const fallback = await transactionTracingService.getReceiptFallbackError(parsedTx.hash!);
      expect(fallback).to.not.be.null;
      expect(fallback!.code).to.equal(-32003);
      expect((fallback!.data as any).provisional).to.be.true;
    });

    it('traces an SDK timeout as timedout', async () => {
      const { ethImpl, transactionTracingService } = generateEthTestEnv();
      const transactionService = ethImpl['transactionService'] as any;
      const { parsedTx, transactionBuffer } = await buildSignedTx();

      const timeoutError = new SDKClientError(
        { status: { _code: Status.Unknown._code }, message: 'timeout exceeded' },
        'timeout exceeded',
        TX_ID,
      );
      sinon.stub(transactionService, 'submitTransaction').resolves({ submittedTransactionId: '', error: timeoutError });

      await transactionService
        .sendRawTransactionProcessor(transactionBuffer, parsedTx, GAS_PRICE, undefined, requestDetails)
        .catch(() => undefined);

      const record = await transactionTracingService.getByHash(parsedTx.hash!);
      expect(record).to.not.be.null;
      expect(record!.status).to.equal('timedout');
    });
  });
});
