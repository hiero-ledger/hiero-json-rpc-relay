// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { JsonRpcError } from '../../../../src/relay/lib/errors/JsonRpcError';
import { RequestDetails } from '../../../../src/relay/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../helpers';
import { EMPTY_LOGS_RESPONSE } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

chai.use(chaiAsPromised);

describe('eth_getTransactionReceipt transaction tracing fallback', function () {
  const requestDetails = new RequestDetails({ requestId: 'eth_getTransactionReceiptTracing', ipAddress: '0.0.0.0' });
  const TX_HASH = '0x' + 'd'.repeat(64);

  const mockMirrorNodeNotFound = (restMock: any): void => {
    restMock.onGet(`contracts/results/${TX_HASH}?hbar=false`).reply(
      404,
      JSON.stringify({
        _status: { messages: [{ message: 'No correlating transaction' }] },
      }),
    );
    restMock
      .onGet(`contracts/results/logs?transaction.hash=${TX_HASH}&limit=100&order=asc`)
      .reply(200, JSON.stringify(EMPTY_LOGS_RESPONSE));
  };

  withOverriddenEnvsInMochaTest({ TX_STATUS_TRACING: true }, function () {
    it('surfaces a -32003 error for a rejected trace when the Mirror Node has nothing', async function () {
      const { ethImpl, restMock, transactionTracingService, cacheService } = generateEthTestEnv();
      await cacheService.clear();
      mockMirrorNodeNotFound(restMock);

      await transactionTracingService.recordRejected(TX_HASH, { error: 'boom', hederaStatus: 'WRONG_NONCE' });

      const error = await ethImpl.getTransactionReceipt(TX_HASH, requestDetails).catch((e: any) => e);
      expect(error).to.be.instanceOf(JsonRpcError);
      expect(error.code).to.equal(-32003);
      expect(error.data.txHash).to.equal(TX_HASH);
    });

    it('surfaces a provisional -32003 error for a timedout trace', async function () {
      const { ethImpl, restMock, transactionTracingService, cacheService } = generateEthTestEnv();
      await cacheService.clear();
      mockMirrorNodeNotFound(restMock);

      await transactionTracingService.recordTimedout(TX_HASH, { error: 'slow' });

      const error = await ethImpl.getTransactionReceipt(TX_HASH, requestDetails).catch((e: any) => e);
      expect(error).to.be.instanceOf(JsonRpcError);
      expect(error.code).to.equal(-32003);
      expect(error.data.provisional).to.be.true;
    });

    it('returns null when there is no trace record', async function () {
      const { ethImpl, restMock, cacheService } = generateEthTestEnv();
      await cacheService.clear();
      mockMirrorNodeNotFound(restMock);

      const receipt = await ethImpl.getTransactionReceipt(TX_HASH, requestDetails);
      expect(receipt).to.be.null;
    });

    it('returns null (no fallback) for a still-pending trace', async function () {
      const { ethImpl, restMock, transactionTracingService, cacheService } = generateEthTestEnv();
      await cacheService.clear();
      mockMirrorNodeNotFound(restMock);

      await transactionTracingService.recordPending(TX_HASH);

      const receipt = await ethImpl.getTransactionReceipt(TX_HASH, requestDetails);
      expect(receipt).to.be.null;
    });
  });

  describe('when TX_STATUS_TRACING is disabled', function () {
    it('returns null even when the Mirror Node has nothing (no tracing)', async function () {
      const { ethImpl, restMock, cacheService } = generateEthTestEnv();
      await cacheService.clear();
      mockMirrorNodeNotFound(restMock);

      const receipt = await ethImpl.getTransactionReceipt(TX_HASH, requestDetails);
      expect(receipt).to.be.null;
    });
  });
});
