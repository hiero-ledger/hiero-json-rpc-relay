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
import { predefined } from '../../../src/relay/lib/errors/JsonRpcError';
import { CacheClientFactory } from '../../../src/relay/lib/factories/cacheClientFactory';
import { CommonService } from '../../../src/relay/lib/services';
import { RequestDetails } from '../../../src/relay/lib/types';
import {
  getRequestAbortSignal,
  isRequestAborted,
  isRequestAbortedError,
  throwIfRequestAborted,
} from '../../../src/relay/lib/utils/requestAbort';

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

    it('throws REQUEST_ABORTED once the signal is aborted', () => {
      const controller = new AbortController();
      const requestDetails = new RequestDetails({
        requestId: 'test-request-id',
        ipAddress: '0.0.0.0',
        abortSignal: controller.signal,
      });
      controller.abort();

      expect(isRequestAborted(requestDetails)).to.equal(true);
      expect(() => throwIfRequestAborted(requestDetails)).to.throw(predefined.REQUEST_ABORTED.message);
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

      await expect(
        mirrorNodeClient.getContractResultsLogsByAddress('0x0000000000000000000000000000000000000001', requestDetails),
      ).to.be.rejectedWith(predefined.REQUEST_ABORTED.message);

      expect(restMock.history.get.length).to.equal(0);
    });

    it('fails an in-flight request with REQUEST_ABORTED and drops the upstream connection', async () => {
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

      await expect(
        commonService.getLogsByAddress(ADDRESSES, { timestamp: ['gte:1', 'lte:2'] }, requestDetails),
      ).to.be.rejectedWith(predefined.REQUEST_ABORTED.message);

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
});
