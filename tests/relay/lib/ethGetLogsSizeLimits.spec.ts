// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import http from 'http';
import { type AddressInfo } from 'net';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { ConfigService } from '../../../src/config-service/services';
import { MirrorNodeClient } from '../../../src/relay/lib/clients';
import { type JsonRpcError, predefined } from '../../../src/relay/lib/errors/JsonRpcError';
import { CacheClientFactory } from '../../../src/relay/lib/factories/cacheClientFactory';
import { CommonService } from '../../../src/relay/lib/services';
import { createLogsCallLimits } from '../../../src/relay/lib/services/ethService/ethCommonService/commonWorker';
import { type MirrorNodeContractLog, RequestDetails } from '../../../src/relay/lib/types';
import { estimateLogsResponseSize, ResponseSizeBudget } from '../../../src/relay/lib/utils/responseSizeBudget';
import { withOverriddenEnvsInMochaTest } from '../helpers';

chai.use(chaiAsPromised);

describe('eth_getLogs response size limits', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const LOGS_REGEX = /contracts\/(?:[^/]+\/)?results\/logs/;
  const TIMESTAMP_RANGE = ['gte:1707944548.000000000', 'lte:1707944552.000000000'];

  const log = (index: number, overrides: Partial<MirrorNodeContractLog> = {}): MirrorNodeContractLog =>
    ({
      address: '0x0000000000000000000000000000000000001389',
      bloom: '0x0123',
      contract_id: '0.0.5001',
      data: '0x0123',
      index,
      topics: ['0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750'],
      block_hash: '0xd773ec74b26ace67ee3924879a6bd35f3c4653baaa19f6c9baec7fac1269c55e',
      block_number: 73884554,
      timestamp: `1707944548.${String(index).padStart(9, '0')}`,
      transaction_hash: `0x${index.toString(16).padStart(64, '0')}`,
      transaction_index: 3,
      ...overrides,
    }) as MirrorNodeContractLog;

  const LOG_SIZE = estimateLogsResponseSize([log(0)]);

  const newRequestDetails = (): RequestDetails =>
    new RequestDetails({ requestId: 'ethGetLogsSizeLimitsTest', ipAddress: '0.0.0.0' });

  const errorOf = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => null,
      (err: unknown) => err,
    );

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  let registry: Registry;
  let mirrorNodeClient: MirrorNodeClient;
  let restMock: MockAdapter;

  beforeEach(() => {
    registry = new Registry();
    mirrorNodeClient = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: 'mirror-node' }),
      registry,
      CacheClientFactory.create(logger, registry),
    );
    restMock = new MockAdapter(mirrorNodeClient.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
  });

  afterEach(() => {
    restMock.restore();
    sinon.restore();
  });

  describe('createLogsCallLimits', () => {
    withOverriddenEnvsInMochaTest({ ETH_GET_LOGS_MAX_RESPONSE_SIZE: 100, ETH_GET_LOGS_MAX_PAGE_SIZE: 50 }, () => {
      it('builds a budget and a page limit from the configuration', () => {
        const call = createLogsCallLimits(newRequestDetails());

        expect(call.limits.maxPageBytes).to.equal(50);
        expect(() => call.limits.budget.consume(101)).to.throw(predefined.LOGS_RESPONSE_SIZE_EXCEEDED(100).message);
        call.dispose();
      });

      it('aborts the call with the budget error once the budget is exceeded', () => {
        const requestDetails = newRequestDetails();
        const call = createLogsCallLimits(requestDetails);

        expect(call.requestDetails.requestId).to.equal(requestDetails.requestId);
        expect(call.requestDetails.abortSignal?.aborted).to.equal(false);

        expect(() => call.limits.budget.consume(101)).to.throw();
        expect(call.requestDetails.abortSignal?.aborted).to.equal(true);
        expect(ResponseSizeBudget.isExceededError(call.requestDetails.abortSignal?.reason)).to.equal(true);
        call.dispose();
      });

      it('aborts the call when the caller abandons the request, and stops listening once disposed', () => {
        const caller = new AbortController();
        const requestDetails = new RequestDetails({
          requestId: 'ethGetLogsSizeLimitsTest',
          ipAddress: '0.0.0.0',
          abortSignal: caller.signal,
        });

        const call = createLogsCallLimits(requestDetails);
        caller.abort(new Error('client gone'));
        expect(call.requestDetails.abortSignal?.aborted).to.equal(true);
        expect((call.requestDetails.abortSignal?.reason as Error).message).to.equal('client gone');
        call.dispose();

        const disposedCaller = new AbortController();
        const disposedCall = createLogsCallLimits(
          new RequestDetails({ requestId: 'x', ipAddress: '0.0.0.0', abortSignal: disposedCaller.signal }),
        );
        disposedCall.dispose();
        disposedCaller.abort();
        expect(disposedCall.requestDetails.abortSignal?.aborted).to.equal(false);
      });

      it('starts aborted when the caller has already abandoned the request', () => {
        const caller = new AbortController();
        caller.abort();
        const call = createLogsCallLimits(
          new RequestDetails({ requestId: 'x', ipAddress: '0.0.0.0', abortSignal: caller.signal }),
        );
        expect(call.requestDetails.abortSignal?.aborted).to.equal(true);
        call.dispose();
      });
    });
  });

  describe('budget shared by the timestamp slices of a call', () => {
    withOverriddenEnvsInMochaTest({ ETH_GET_LOGS_MAX_RESPONSE_SIZE: LOG_SIZE * 5 }, () => {
      it('fails with -32005 once the budget is exceeded, stops every slice and does not fall back to sequential', async () => {
        let index = 0;
        // every slice has an endless number of pages, so only the budget can stop the call
        restMock.onGet(LOGS_REGEX).reply(async () => {
          await delay(5);
          const page = index++;
          return [
            200,
            JSON.stringify({
              logs: [log(page)],
              links: { next: `/api/v1/contracts/results/logs?timestamp=gte:1707944548.000000000&page=${page}` },
            }),
          ];
        });

        const call = createLogsCallLimits(newRequestDetails());
        const error = await errorOf(
          mirrorNodeClient.getContractResultsLogsWithRetry(
            call.requestDetails,
            4,
            { timestamp: TIMESTAMP_RANGE },
            undefined,
            call.limits,
          ),
        );
        call.dispose();

        expect(error).to.deep.equal(predefined.LOGS_RESPONSE_SIZE_EXCEEDED(LOG_SIZE * 5));
        expect(ResponseSizeBudget.isExceededError(error)).to.equal(true);
        expect(call.requestDetails.abortSignal?.aborted).to.equal(true);

        // no slice asks for another page once the call has failed
        const requestsAtFailure = restMock.history.get.length;
        await delay(50);
        expect(restMock.history.get.length).to.equal(requestsAtFailure);
        // at most the page that crossed the limit plus one in-flight page per other slice
        expect(requestsAtFailure).to.be.at.most(6 + 3);

        // a sequential fallback would request the original, unsliced range
        const urls = restMock.history.get.map((req) => decodeURIComponent(req.url ?? ''));
        expect(urls.some((url) => url.includes(TIMESTAMP_RANGE[0]) && url.includes(TIMESTAMP_RANGE[1]))).to.equal(
          false,
        );
      });

      it('returns the logs when they fit in the budget', async () => {
        let index = 0;
        restMock.onGet(LOGS_REGEX).reply(() => [200, JSON.stringify({ logs: [log(index++)] })]);

        const call = createLogsCallLimits(newRequestDetails());
        const logs = await mirrorNodeClient.getContractResultsLogsWithRetry(
          call.requestDetails,
          4,
          { timestamp: TIMESTAMP_RANGE },
          undefined,
          call.limits,
        );
        call.dispose();

        expect(logs).to.have.length(4);
        expect(call.limits.budget.usedBytes).to.equal(LOG_SIZE * 4);
      });
    });
  });

  describe('budget shared by the addresses of a call', () => {
    withOverriddenEnvsInMochaTest({ ETH_GET_LOGS_MAX_RESPONSE_SIZE: LOG_SIZE * 5 }, () => {
      it('fails once the logs of all addresses together exceed the budget', async () => {
        let index = 0;
        // each address alone (2 logs) fits in the budget, the three together (6 logs) do not
        restMock.onGet(LOGS_REGEX).reply(() => [200, JSON.stringify({ logs: [log(index++), log(index++)] })]);

        const commonService = new CommonService(mirrorNodeClient, logger, CacheClientFactory.create(logger, registry));
        const call = createLogsCallLimits(newRequestDetails());
        const error = await errorOf(
          commonService.getLogsWithParams(
            [
              '0x0000000000000000000000000000000000000001',
              '0x0000000000000000000000000000000000000002',
              '0x0000000000000000000000000000000000000003',
            ],
            { timestamp: TIMESTAMP_RANGE },
            call.requestDetails,
            1,
            call.limits,
          ),
        );
        call.dispose();

        expect(error).to.deep.equal(predefined.LOGS_RESPONSE_SIZE_EXCEEDED(LOG_SIZE * 5));
      });
    });
  });

  describe('immature-record retries', () => {
    withOverriddenEnvsInMochaTest({ ETH_GET_LOGS_MAX_RESPONSE_SIZE: Math.floor(LOG_SIZE * 1.5) }, () => {
      it('releases the bytes of an attempt before retrying it, so the same logs are not counted twice', async () => {
        sinon.stub(mirrorNodeClient, 'getMirrorNodeRetryDelay').returns(0);
        const immature = log(0, { block_number: null, transaction_index: null, block_hash: '0x' } as never);
        restMock
          .onGet(LOGS_REGEX)
          .replyOnce(200, JSON.stringify({ logs: [immature] }))
          .onGet(LOGS_REGEX)
          .replyOnce(200, JSON.stringify({ logs: [log(0)] }));

        const call = createLogsCallLimits(newRequestDetails());
        const logs = await mirrorNodeClient.getContractResultsLogsWithRetry(
          call.requestDetails,
          1,
          { timestamp: TIMESTAMP_RANGE },
          undefined,
          call.limits,
        );
        call.dispose();

        expect(restMock.history.get.length).to.equal(2);
        expect(logs).to.have.length(1);
        expect(call.limits.budget.usedBytes).to.equal(LOG_SIZE);
      });
    });
  });

  describe('Mirror Node page size limit', () => {
    let upstream: http.Server;
    let upstreamRequests: number;
    let port: number;

    // a page of ~64 KiB, streamed without a Content-Length header so the limit is enforced while downloading
    const LARGE_PAGE = JSON.stringify({ logs: [log(0, { data: `0x${'ab'.repeat(32 * 1024)}` })] });

    beforeEach(async () => {
      upstreamRequests = 0;
      upstream = http.createServer((_req, res) => {
        upstreamRequests++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        for (let i = 0; i < LARGE_PAGE.length; i += 4096) {
          res.write(LARGE_PAGE.slice(i, i + 4096));
        }
        res.end();
      });
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
      port = (upstream.address() as AddressInfo).port;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });

    const newRealClient = (): MirrorNodeClient =>
      new MirrorNodeClient(
        `http://127.0.0.1:${port}`,
        logger.child({ name: 'mirror-node' }),
        registry,
        CacheClientFactory.create(logger, registry),
      );

    withOverriddenEnvsInMochaTest(
      { ETH_GET_LOGS_MAX_PAGE_SIZE: 1024, MIRROR_NODE_RETRIES: 3, MIRROR_NODE_RETRY_DELAY: 10 },
      () => {
        it('stops a page over the limit while it downloads, fails with -32005 and does not retry it', async () => {
          const call = createLogsCallLimits(newRequestDetails());
          const error = (await errorOf(
            newRealClient().getContractResultsLogsByAddress(
              '0x0000000000000000000000000000000000000001',
              call.requestDetails,
              1,
              { timestamp: TIMESTAMP_RANGE },
              undefined,
              call.limits,
            ),
          )) as JsonRpcError;
          call.dispose();

          expect(error).to.deep.equal(predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(1024));
          expect(error.code).to.equal(-32005);
          expect(upstreamRequests).to.equal(1);
        });

        it('does not fall back to sequential pagination after a page over the limit', async () => {
          const call = createLogsCallLimits(newRequestDetails());
          const error = await errorOf(
            newRealClient().getContractResultsLogsWithRetry(
              call.requestDetails,
              2,
              { timestamp: TIMESTAMP_RANGE },
              undefined,
              call.limits,
            ),
          );
          call.dispose();

          expect(error).to.deep.equal(predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(1024));
          // the call fails with the first slice; let the other slice finish before counting
          await delay(200);
          // one request per slice, no retries and no sequential fallback
          expect(upstreamRequests).to.equal(2);
        });

        it('does not limit the page size of log requests made without size limits', async () => {
          const logs = await newRealClient().getContractResultsLogsByAddress(
            '0x0000000000000000000000000000000000000001',
            newRequestDetails(),
            1,
            { timestamp: TIMESTAMP_RANGE },
          );

          expect(logs).to.have.length(1);
          expect(upstreamRequests).to.equal(1);
        });
      },
    );
  });

  describe('isMaxContentLengthError', () => {
    it('recognizes only the error axios raises at maxContentLength', () => {
      const axiosError = (message: string, code: string): Error =>
        Object.assign(new Error(message), { isAxiosError: true, code });

      expect(
        MirrorNodeClient.isMaxContentLengthError(
          axiosError('maxContentLength size of 10 exceeded', 'ERR_BAD_RESPONSE'),
        ),
      ).to.equal(true);
      expect(
        MirrorNodeClient.isMaxContentLengthError(axiosError('stream has been aborted', 'ERR_BAD_RESPONSE')),
      ).to.equal(false);
      expect(MirrorNodeClient.isMaxContentLengthError(new Error('maxContentLength size of 10 exceeded'))).to.equal(
        false,
      );
      expect(MirrorNodeClient.isMaxContentLengthError(undefined)).to.equal(false);
    });
  });
});
