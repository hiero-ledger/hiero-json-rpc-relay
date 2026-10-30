// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createSandbox } from 'sinon';

import type { Transaction } from '../../../../src/relay/lib/model';
import { type ITransactionReceipt, RequestDetails } from '../../../../src/relay/lib/types';
import { defaultDetailedContractResultByHash } from '../../helpers';
import { DEFAULT_LOGS_3 } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('transaction lookups racing mirror ingestion', function () {
  const { restMock, ethImpl, mirrorNodeInstance, cacheService } = generateEthTestEnv();
  const sandbox = createSandbox();
  const hash = `0x${'93'.repeat(32)}`;
  const resultUrl = `contracts/results/${hash}?hbar=false`;
  const logsUrl = `contracts/results/logs?transaction.hash=${hash}&limit=100&order=asc`;
  const requestDetails = new RequestDetails({ requestId: 'mirrorLookupRace', ipAddress: '0.0.0.0' });
  const record = {
    ...defaultDetailedContractResultByHash,
    hash,
    type: 2,
    transaction_index: 0,
    created_contract_ids: [],
    from: `0x${'11'.repeat(20)}`,
    to: `0x${'22'.repeat(20)}`,
    function_parameters: '0x12345678',
    nonce: 7,
    gas_limit: 123456,
    gas_used: 65432,
  };
  const logs = DEFAULT_LOGS_3.map((log) => ({
    ...log,
    address: record.to,
    transaction_hash: hash,
    transaction_index: 0,
    block_hash: record.block_hash,
    block_number: record.block_number,
  }));

  beforeEach(async () => {
    restMock.reset();
    await cacheService.clear();
    sandbox.stub(ethImpl['common'], 'resolveEvmAddress').callsFake(async (address) => address);
    sandbox.stub(ethImpl['common'], 'isContractDeployment').resolves(false);
    sandbox.stub(ethImpl['common'], 'getCurrentGasPriceForBlock').resolves('0x1');
  });

  afterEach(() => sandbox.restore());

  for (const method of ['getTransactionByHash', 'getTransactionReceipt'] as const) {
    describe(method, () => {
      const lookup = (): Promise<Transaction | ITransactionReceipt | null> => ethImpl[method](hash, requestDetails);

      for (const initialResponse of [404, 200]) {
        it(`uses the real transaction when it appears between a ${initialResponse} missing-result response and logs`, async () => {
          const requests: string[] = [];
          let logsVisible = false;
          restMock.onGet(resultUrl).reply(() => {
            requests.push('result');
            return logsVisible ? [200, record] : [initialResponse, {}];
          });
          restMock.onGet(logsUrl).reply(() => {
            requests.push('logs');
            // The importer commits after the first request and before the logs request.
            logsVisible = true;
            return [200, { logs }];
          });

          const result = await lookup();
          expect(result).to.include({ from: record.from, to: record.to, type: '0x2' });
          if (method === 'getTransactionByHash') {
            expect(result).to.include({
              hash,
              input: record.function_parameters,
              nonce: '0x7',
              gas: '0x1e240',
              r: record.r,
              s: record.s,
            });
          } else {
            expect(result).to.include({ transactionHash: hash, gasUsed: '0xff98' });
          }
          expect(requests).to.deep.equal(['result', 'logs', 'result']);
          // A synthetic result must not poison the outer RPC cache either.
          expect(await lookup()).to.deep.equal(result);
          expect(requests).to.deep.equal(['result', 'logs', 'result']);
        });
      }

      it('does not add a lookup when the first result is already available', async () => {
        restMock.onGet(resultUrl).reply(200, record);
        expect(await lookup()).to.include({ from: record.from, type: '0x2' });
        expect(restMock.history.get.map(({ url }) => url)).to.deep.equal([resultUrl]);
      });

      it('returns null without rechecking when neither the result nor logs exist', async () => {
        restMock.onGet(resultUrl).reply(404, {});
        restMock.onGet(logsUrl).reply(200, { logs: [] });
        expect(await lookup()).to.be.null;
        expect(restMock.history.get.map(({ url }) => url)).to.deep.equal([resultUrl, logsUrl]);
      });

      it('retains the synthetic fallback when the result is still absent after logs are visible', async () => {
        restMock.onGet(resultUrl).reply(404, {});
        restMock.onGet(logsUrl).reply(200, { logs });
        const result = await lookup();
        expect(result).to.not.be.null;
        expect(result).to.have.property(method === 'getTransactionByHash' ? 'hash' : 'transactionHash', hash);
        expect(restMock.history.get.map(({ url }) => url)).to.deep.equal([resultUrl, logsUrl, resultUrl]);
      });

      it('honors rejection handling when the recheck finds an immature rejected record', async () => {
        restMock.onGet(resultUrl).replyOnce(404, {});
        restMock.onGet(resultUrl).reply(200, {
          ...record,
          result: 'WRONG_NONCE',
          block_hash: '0x',
          block_number: null,
          transaction_index: null,
        });
        restMock.onGet(logsUrl).reply(200, { logs });
        if (method === 'getTransactionByHash') {
          expect(await lookup()).to.be.null;
        } else {
          await expect(lookup()).to.be.rejected.and.eventually.have.property('code', -32003);
        }
        expect(restMock.history.get.map(({ url }) => url)).to.deep.equal([resultUrl, logsUrl, resultUrl]);
      });

      it('propagates a failed recheck instead of manufacturing a synthetic transaction', async () => {
        const failure = new Error('mirror lookup failed');
        const getResult = sandbox.stub(mirrorNodeInstance, 'getContractResultWithRetry');
        getResult.onFirstCall().resolves(null);
        getResult.onSecondCall().rejects(failure);
        restMock.onGet(logsUrl).reply(200, { logs });
        await expect(lookup()).to.be.rejectedWith(failure.message);
        expect(getResult.callCount).to.equal(2);
      });
    });
  }
});
