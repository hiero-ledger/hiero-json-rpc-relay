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
import { type ICacheClient } from '../../../src/relay/lib/clients/cache/ICacheClient';
import constants, { TracerType } from '../../../src/relay/lib/constants';
import { DebugImpl } from '../../../src/relay/lib/debug';
import { JsonRpcError } from '../../../src/relay/lib/errors/JsonRpcError';
import { CacheClientFactory } from '../../../src/relay/lib/factories/cacheClientFactory';
import {
  CommonService,
  ContractService,
  type LockService,
  type TransactionPoolService,
  type TransactionTracingService,
} from '../../../src/relay/lib/services';
import { FeeService } from '../../../src/relay/lib/services/ethService/feeService/FeeService';
import type HAPIService from '../../../src/relay/lib/services/hapiService/hapiService';
import { type ContractAction, type MirrorNodeBlock, RequestDetails } from '../../../src/relay/lib/types';
import {
  getRequestAbortSignal,
  isRequestAborted,
  isRequestAbortedError,
  requestAbortReason,
  throwIfRequestAborted,
} from '../../../src/relay/lib/utils/requestAbort';
import { overrideEnvsInMochaDescribe } from '../helpers';

chai.use(chaiAsPromised);

describe('Request cancellation', function () {
  const logger = pino({ level: 'silent' });
  const LOGS_QUERY_REGEX = /contracts\/[^/]+\/results\/logs/;

  let registry: Registry;
  let mirrorNodeClient: MirrorNodeClient;
  let restMock: MockAdapter;

  beforeEach(() => {
    registry = new Registry();
    const cacheService = CacheClientFactory.create(logger, registry);
    mirrorNodeClient = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: 'mirror-node' }),
      registry,
      cacheService,
    );
    restMock = new MockAdapter(mirrorNodeClient.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
  });

  afterEach(() => {
    restMock.restore();
    sinon.restore();
  });

  describe('RequestDetails', () => {
    it('exposes the abort signal it was constructed with', () => {
      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });

      expect(requestDetails.abortSignal).to.equal(controller.signal);
      expect(getRequestAbortSignal(requestDetails)).to.equal(controller.signal);
    });

    it('survives the structured clone used to dispatch a task to a worker thread', () => {
      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });

      const clone = structuredClone(requestDetails) as RequestDetails;

      expect(clone.requestId).to.equal('test-request-id');
      expect(clone.abortSignal).to.equal(undefined);
      expect(isRequestAborted(clone)).to.equal(false);
    });

    it('reports a request without a signal as not aborted', () => {
      const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });

      expect(isRequestAborted(requestDetails)).to.equal(false);
      expect(isRequestAborted(undefined)).to.equal(false);
      expect(() => throwIfRequestAborted(requestDetails)).to.not.throw();
    });

    it('throws the native abort error once the signal is aborted', () => {
      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });
      controller.abort();

      expect(isRequestAborted(requestDetails)).to.equal(true);

      let error: unknown = null;
      try {
        throwIfRequestAborted(requestDetails);
      } catch (err: unknown) {
        error = err;
      }

      expect(isRequestAbortedError(error)).to.equal(true);
      expect((error as Error).name).to.equal('AbortError');
    });
  });

  describe('MirrorNodeClient', () => {
    it('does not issue an upstream request for an already abandoned request', async () => {
      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });
      restMock.onGet(LOGS_QUERY_REGEX).reply(200, JSON.stringify({ logs: [] }));
      controller.abort();

      const error = await mirrorNodeClient
        .getContractResultsLogsByAddress('0x0000000000000000000000000000000000000001', requestDetails)
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(isRequestAbortedError(error)).to.equal(true);
      expect(restMock.history.get.length).to.equal(0);
    });

    it('fails an in-flight request with the native abort error and drops the upstream connection', async () => {
      let upstreamRequests = 0;
      let resolveUpstreamClosed: (closedBeforeResponse: boolean) => void;
      const upstreamClosed = new Promise<boolean>((resolve) => {
        resolveUpstreamClosed = resolve;
      });
      const upstream = http.createServer((req, res) => {
        upstreamRequests++;
        req.once('close', () => resolveUpstreamClosed(!res.writableEnded));
      });
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
      const { port } = upstream.address() as AddressInfo;

      const cacheService = CacheClientFactory.create(logger, registry);
      const client = new MirrorNodeClient(
        `http://127.0.0.1:${port}`,
        logger.child({ name: 'mirror-node' }),
        registry,
        cacheService,
      );

      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });

      try {
        const pending = client.getContractResultsLogsByAddress(
          '0x0000000000000000000000000000000000000001',
          requestDetails,
        );
        setTimeout(() => controller.abort(), 100);

        const error = await pending.then(
          () => null,
          (err: unknown) => err,
        );

        expect(isRequestAbortedError(error)).to.equal(true);
        expect(await upstreamClosed).to.equal(true);
        expect(upstreamRequests).to.equal(1);
      } finally {
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      }
    });

    it('does not leave an unhandled rejection behind when the caller abandons a sliced logs query', async () => {
      const unhandled: unknown[] = [];
      const onUnhandledRejection = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.prependListener('unhandledRejection', onUnhandledRejection);

      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });
      restMock
        .onGet(/contracts\/results\/logs/)
        .reply(() => new Promise((resolve) => setTimeout(() => resolve([200, JSON.stringify({ logs: [] })]), 50)));

      try {
        const pending = mirrorNodeClient.getContractResultsLogsWithRetry(
          requestDetails,
          4,
          { timestamp: ['gte:1707944548.000000000', 'lte:1707944552.000000000'] },
          undefined,
        );
        setTimeout(() => controller.abort(requestAbortReason('client gone')), 10);

        const error = await pending.then(
          () => null,
          (err: unknown) => err,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(isRequestAbortedError(error)).to.equal(true);
        expect(unhandled).to.deep.equal([]);
      } finally {
        process.removeListener('unhandledRejection', onUnhandledRejection);
      }
    });

    it('leaves a request without a signal unaffected', async () => {
      const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });
      restMock.onGet(LOGS_QUERY_REGEX).reply(200, JSON.stringify({ logs: [] }));

      const logs = await mirrorNodeClient.getContractResultsLogsByAddress(
        '0x0000000000000000000000000000000000000001',
        requestDetails,
      );

      expect(logs).to.deep.equal([]);
      expect(restMock.history.get.length).to.equal(1);
    });
  });

  describe('CommonService multi-address fan-out', () => {
    const ADDRESSES = Array.from({ length: 20 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);

    let commonService: CommonService;

    beforeEach(() => {
      const cacheService = CacheClientFactory.create(logger, registry);
      commonService = new CommonService(mirrorNodeClient, logger, cacheService);
    });

    it('stops fetching the remaining addresses once the caller abandons the request', async () => {
      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });

      restMock.onGet(LOGS_QUERY_REGEX).reply(() => {
        controller.abort();
        return new Promise((resolve) => {
          setTimeout(() => resolve([200, JSON.stringify({ logs: [] })]), 50);
        });
      });

      const error = await commonService
        .getLogsByAddress(ADDRESSES, { timestamp: ['gte:1', 'lte:2'] }, requestDetails)
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(isRequestAbortedError(error)).to.equal(true);
      expect(restMock.history.get.length).to.be.lessThan(ADDRESSES.length);
    });

    it('fetches every address when the request is not abandoned', async () => {
      const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });
      restMock.onGet(LOGS_QUERY_REGEX).reply(200, JSON.stringify({ logs: [] }));

      const logs = await commonService.getLogsByAddress(ADDRESSES, { timestamp: ['gte:1', 'lte:2'] }, requestDetails);

      expect(logs).to.deep.equal([]);
      expect(restMock.history.get.length).to.equal(ADDRESSES.length);
    });
  });

  describe('error handlers', () => {
    const abortError = requestAbortReason('client disconnected');
    const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });

    let commonService: CommonService;
    let contractService: ContractService;
    let loggerErrorSpy: sinon.SinonSpy;

    beforeEach(() => {
      const cacheService = CacheClientFactory.create(logger, registry);
      commonService = new CommonService(mirrorNodeClient, logger, cacheService);
      contractService = new ContractService(cacheService, commonService, {} as HAPIService, logger, mirrorNodeClient);
      loggerErrorSpy = sinon.spy(logger, 'error');
    });

    it('rethrows the abort error from the generic error handler instead of an internal error', () => {
      expect(() => commonService.genericErrorHandler(abortError, 'Failed to retrieve block')).to.throw(abortError);
      expect(loggerErrorSpy.called).to.equal(false);
    });

    it('still maps an unexpected error to an internal error in the generic error handler', () => {
      expect(() => commonService.genericErrorHandler(new Error('boom'))).to.throw(JsonRpcError);
    });

    it('rethrows the abort error from eth_call', async () => {
      sinon.stub(contractService, 'contractCallFormat').resolves();
      sinon
        .stub(contractService as unknown as { callMirrorNode: () => Promise<string> }, 'callMirrorNode')
        .rejects(abortError);

      await expect(
        contractService.call({ to: '0x0000000000000000000000000000000000000001' }, 'latest', requestDetails),
      ).to.be.rejectedWith(abortError);
      expect(loggerErrorSpy.called).to.equal(false);
    });

    it('rethrows the abort error from eth_estimateGas', async () => {
      sinon
        .stub(
          contractService as unknown as { estimateGasFromMirrorNode: () => Promise<unknown> },
          'estimateGasFromMirrorNode',
        )
        .rejects(abortError);

      await expect(contractService.estimateGas({}, null, requestDetails)).to.be.rejectedWith(abortError);
      expect(loggerErrorSpy.called).to.equal(false);
    });
  });

  describe('fallback catch blocks', () => {
    const abortError = requestAbortReason('client disconnected');
    const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '0.0.0.0' });
    const TX_HASH = `0x${'ab'.repeat(32)}`;
    const block = {
      number: 10,
      count: 1,
      gas_used: 0,
      timestamp: { from: '1700000000.000000000', to: '1700000001.000000000' },
    } as MirrorNodeBlock;

    let cacheService: ICacheClient;
    let commonService: CommonService;
    let loggerWarnSpy: sinon.SinonSpy;
    let loggerErrorSpy: sinon.SinonSpy;

    beforeEach(() => {
      cacheService = CacheClientFactory.create(logger, registry);
      commonService = new CommonService(mirrorNodeClient, logger, cacheService);
      loggerWarnSpy = sinon.spy(logger, 'warn');
      loggerErrorSpy = sinon.spy(logger, 'error');
    });

    const expectNothingLogged = (): void => {
      expect(loggerWarnSpy.called, 'logged a warning').to.equal(false);
      expect(loggerErrorSpy.called, 'logged an error').to.equal(false);
    };

    describe('eth_feeHistory', () => {
      overrideEnvsInMochaDescribe({ ETH_FEE_HISTORY_FIXED: false });

      let feeService: FeeService;

      beforeEach(() => {
        feeService = new FeeService(mirrorNodeClient, commonService, logger);
        sinon.stub(commonService, 'translateBlockTag').resolves(block.number);
      });

      it('rethrows the abort error when the block range fetch is abandoned', async () => {
        sinon.stub(mirrorNodeClient, 'getBlocksByRange').rejects(abortError);

        await expect(feeService.feeHistory(1, 'latest', null, requestDetails)).to.be.rejectedWith(abortError);
        expectNothingLogged();
      });

      it('rethrows the abort error when a block fetch is abandoned', async () => {
        sinon.stub(mirrorNodeClient, 'getBlocksByRange').resolves([]);
        sinon.stub(mirrorNodeClient, 'getBlock').rejects(abortError);

        await expect(feeService.feeHistory(1, 'latest', null, requestDetails)).to.be.rejectedWith(abortError);
        expectNothingLogged();
      });

      it('rethrows the abort error when a block fee lookup is abandoned', async () => {
        sinon.stub(mirrorNodeClient, 'getBlocksByRange').resolves([block]);
        sinon.stub(mirrorNodeClient, 'getLatestContractResultForBlock').rejects(abortError);

        await expect(feeService.feeHistory(1, 'latest', null, requestDetails)).to.be.rejectedWith(abortError);
        expectNothingLogged();
      });
    });

    describe('debug tracers', () => {
      let debugService: DebugImpl;

      beforeEach(() => {
        debugService = new DebugImpl(
          mirrorNodeClient,
          logger,
          cacheService,
          ConfigService.get('CHAIN_ID'),
          {} as HAPIService,
          {} as TransactionPoolService,
          {} as LockService,
          registry,
          {} as TransactionTracingService,
        );
      });

      it('rethrows the abort error from the prestate tracer when a contract state fetch is abandoned', async () => {
        const contractAddress = '0x0000000000000000000000000000000000000002';
        const action = {
          from: contractAddress,
          caller_type: constants.TYPE_CONTRACT,
          timestamp: block.timestamp.from,
        } as ContractAction;
        sinon.stub(mirrorNodeClient, 'getContractsResultsActions').resolves([action]);
        sinon.stub(mirrorNodeClient, 'getContractResultWithRetry').resolves({ hash: TX_HASH });
        sinon.stub(mirrorNodeClient, 'resolveEntityType').resolves({
          type: constants.TYPE_CONTRACT,
          entity: { contract_id: '0.0.2', evm_address: contractAddress },
        });
        sinon.stub(mirrorNodeClient, 'getBalanceAtTimestamp').resolves({ timestamp: null, balances: [] });
        sinon.stub(mirrorNodeClient, 'getContractState').rejects(abortError);
        const cacheSetSpy = sinon.spy(cacheService, 'set');

        await expect(debugService.prestateFromContractState(TX_HASH, requestDetails)).to.be.rejectedWith(abortError);
        expect(cacheSetSpy.called).to.equal(false);
        expectNothingLogged();
      });

      it('does not cache a partial prestate when the request is abandoned while entities are resolved', async () => {
        const controller = new AbortController();
        const abandonedRequestDetails = new RequestDetails({
          requestId: 'test-request-id',
          ipAddress: '0.0.0.0',
          abortSignal: controller.signal,
        });
        const action = {
          from: '0x0000000000000000000000000000000000000001',
          caller_type: 'ACCOUNT',
          timestamp: block.timestamp.from,
        } as ContractAction;
        sinon.stub(mirrorNodeClient, 'getContractsResultsActions').resolves([action]);
        sinon.stub(mirrorNodeClient, 'getContractResultWithRetry').resolves({ hash: TX_HASH });
        // resolveEntityType turns an aborted lookup into null, like any other failed lookup.
        sinon.stub(mirrorNodeClient, 'resolveEntityType').callsFake(async () => {
          controller.abort(abortError);
          return null;
        });
        const cacheSetSpy = sinon.spy(cacheService, 'set');

        await expect(debugService.prestateFromContractState(TX_HASH, abandonedRequestDetails)).to.be.rejectedWith(
          abortError,
        );
        expect(cacheSetSpy.called).to.equal(false);
        expectNothingLogged();
      });

      it('rethrows the abort error from the prestate endpoint instead of falling back to the contract state', async () => {
        sinon.stub(mirrorNodeClient, 'getContractResultPrestate').rejects(abortError);
        const actionsStub = sinon.stub(mirrorNodeClient, 'getContractsResultsActions');

        await expect(debugService.prestateTracer(TX_HASH, {}, requestDetails)).to.be.rejectedWith(abortError);
        expect(actionsStub.called).to.equal(false);
        expectNothingLogged();
      });

      it('rethrows the abort error from debug_traceBlockByNumber when the actions prefetch is abandoned', async () => {
        sinon.stub(CommonService.prototype, 'getHistoricalBlockResponse').resolves(block);
        sinon
          .stub(mirrorNodeClient, 'getContractResultWithRetry')
          .resolves([{ hash: TX_HASH, result: 'SUCCESS', gas_used: 21000 }]);
        sinon.stub(mirrorNodeClient, 'getContractsResultsActions').rejects(abortError);

        await expect(
          debugService.traceBlockByNumber('0xa', { tracer: TracerType.CallTracer }, requestDetails),
        ).to.be.rejectedWith(abortError);
        expectNothingLogged();
      });
    });

    it('rethrows the abort error from eth_getLogs when sizing the timestamp slices is abandoned', async () => {
      sinon
        .stub(commonService, 'getHistoricalBlockResponse')
        .onFirstCall()
        .resolves({ ...block, number: 1 })
        .onSecondCall()
        .resolves(block);
      sinon.stub(mirrorNodeClient, 'getBlocksByRange').rejects(abortError);

      await expect(
        commonService.validateBlockRangeAndAddTimestampToParams(
          {},
          '0x1',
          'latest',
          requestDetails,
          '0x0000000000000000000000000000000000000001',
          { value: 1 },
        ),
      ).to.be.rejectedWith(abortError);
      expectNothingLogged();
    });
  });
});
