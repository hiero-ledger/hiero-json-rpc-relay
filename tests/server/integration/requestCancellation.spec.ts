// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '../../../src/config-service/services';
import { ConfigServiceTestHelper } from '../../config-service/configServiceTestHelper';
ConfigServiceTestHelper.appendEnvsFromPath(__dirname + '/test.env');

import Axios, { type AxiosInstance } from 'axios';
import { expect } from 'chai';
import http, { type Server } from 'http';
import type Koa from 'koa';
import { type AddressInfo } from 'net';
import sinon from 'sinon';

import { Relay } from '../../../src/relay';
import { resetWorkerContext } from '../../../src/relay/lib/services/workersService/workerContext';
import { WorkersPool } from '../../../src/relay/lib/services/workersService/WorkersPool';
import { initializeServer } from '../../../src/server/server';
import { asRelayInternals } from '../../relay/helpers';

type WorkersPoolTestInternals = {
  _innerRun?: typeof WorkersPool.run;
  run: typeof WorkersPool.run;
  instance: unknown;
  handleTaskFn: unknown;
};

const resetWorkersPoolState = (): void => {
  const pool = WorkersPool as unknown as WorkersPoolTestInternals;

  if (pool._innerRun) {
    pool.run = pool._innerRun;
    delete pool._innerRun;
  }
  pool.instance = undefined;
  pool.handleTaskFn = null;
  resetWorkerContext();
};

describe('Request cancellation', function () {
  this.timeout(30_000);

  const ADDRESS_COUNT = 40;
  const UPSTREAM_DELAY_MS = 300;
  const ABORT_AFTER_MS = 50;
  const ABORT_SETTLE_MS = 600;
  const UPSTREAM_MAX_SOCKETS = 4;
  const addressesFor = (id: number): string[] =>
    Array.from({ length: ADDRESS_COUNT }, (_, i) => `0x${(id * 1000 + i + 1).toString(16).padStart(40, '0')}`);
  let upstream: Server;
  let relayServer: Server;
  let relayClient: AxiosInstance;
  let app: Koa<Koa.DefaultState, Koa.DefaultContext>;
  let logRequests = 0;
  type ConfigValue = Parameters<typeof ConfigServiceTestHelper.dynamicOverride>[1];
  let overriddenConfig: Record<string, ConfigValue> = {};
  const previousConfig: Record<string, ConfigValue> = {};

  const getLogsPayload = (id: number): Record<string, unknown> => ({
    jsonrpc: '2.0',
    id,
    method: 'eth_getLogs',
    params: [{ fromBlock: '0x1', toBlock: '0x1', address: addressesFor(id), topics: [] }],
  });

  const sendAndAbort = async (id: number): Promise<void> => {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), ABORT_AFTER_MS);

    await relayClient.post('/', getLogsPayload(id), { signal: abortController.signal }).then(
      () => expect.fail('the aborted request is not expected to produce a response'),
      () => undefined,
    );
  };

  const BATCH_SIZE = 4;
  const BATCH_ADDRESS_COUNT = ADDRESS_COUNT / BATCH_SIZE;

  const getBatchPayload = (id: number): Record<string, unknown>[] =>
    Array.from({ length: BATCH_SIZE }, (_, i) => ({
      jsonrpc: '2.0',
      id: id + i,
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: '0x1',
          toBlock: '0x1',
          address: addressesFor(id + i).slice(0, BATCH_ADDRESS_COUNT),
          topics: [],
        },
      ],
    }));

  const sendBatchAndAbort = async (id: number): Promise<void> => {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), ABORT_AFTER_MS);

    await relayClient.post('/', getBatchPayload(id), { signal: abortController.signal }).then(
      () => expect.fail('the aborted batch request is not expected to produce a response'),
      () => undefined,
    );
  };

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  before(async function () {
    upstream = http.createServer((req, res) => {
      const url = req.url ?? '';
      res.setHeader('Content-Type', 'application/json');

      if (url.includes('/results/logs')) {
        logRequests++;
        setTimeout(() => {
          if (!res.writableEnded) {
            res.end(JSON.stringify({ logs: [], links: { next: null } }));
          }
        }, UPSTREAM_DELAY_MS);
        return;
      }

      if (url.includes('/blocks')) {
        const block = {
          number: 1,
          hash: `0x${'ab'.repeat(32)}`,
          timestamp: { from: '1700000000.000000000', to: '1700000001.000000000' },
          count: 1,
          logs_bloom: '0x',
        };
        res.end(JSON.stringify(url.includes('/blocks/') ? block : { blocks: [block] }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ _status: { messages: [{ message: 'Not found' }] } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    overriddenConfig = {
      MIRROR_NODE_URL: upstreamUrl,
      MIRROR_NODE_URL_WEB3: upstreamUrl,
      READ_ONLY: true,
      REDIS_ENABLED: false,
      RATE_LIMIT_DISABLED: true,
      MAX_ADDRESSES_PER_REQUEST: ADDRESS_COUNT,
      MIRROR_NODE_HTTP_MAX_SOCKETS: UPSTREAM_MAX_SOCKETS,
      WORKERS_POOL_ENABLED: false,
    };
    for (const [name, value] of Object.entries(overriddenConfig)) {
      previousConfig[name] = ConfigService.get(name as Parameters<typeof ConfigService.get>[0]) as ConfigValue;
      ConfigServiceTestHelper.dynamicOverride(name, value);
    }

    resetWorkersPoolState();

    sinon.stub(asRelayInternals(Relay.prototype), 'waitForMirrorNode').resolves();

    delete require.cache[require.resolve('../../../src/server/server')];
    app = (await initializeServer()).app;
    relayServer = app.listen(0);
    relayClient = Axios.create({
      baseURL: `http://127.0.0.1:${(relayServer.address() as AddressInfo).port}`,
      headers: { 'Content-Type': 'application/json' },
      timeout: 20_000,
      validateStatus: () => true,
    });
  });

  after(async function () {
    sinon.restore();
    resetWorkersPoolState();
    for (const name of Object.keys(overriddenConfig)) {
      ConfigServiceTestHelper.dynamicOverride(name, previousConfig[name]);
    }
    await new Promise<void>((resolve) => relayServer.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  beforeEach(function () {
    logRequests = 0;
  });

  it('fans out to every address when the client waits for the response', async function () {
    const response = await relayClient.post('/', getLogsPayload(1));

    expect(response.status).to.equal(200);
    expect(response.data.result).to.deep.equal([]);
    expect(logRequests).to.equal(ADDRESS_COUNT);
  });

  it('stops the downstream fan-out when the client aborts the request', async function () {
    await sendAndAbort(2);

    await sleep(ABORT_SETTLE_MS);
    const requestsAfterAbort = logRequests;

    await sleep(UPSTREAM_DELAY_MS * 4);
    expect(logRequests).to.equal(requestsAfterAbort);
    expect(logRequests).to.be.at.most(UPSTREAM_MAX_SOCKETS * 2);
  });

  it('stops the downstream fan-out for repeated aborted requests', async function () {
    const abortedRequests = 5;
    await Promise.all(Array.from({ length: abortedRequests }, (_, i) => sendAndAbort(10 + i)));

    await sleep(ABORT_SETTLE_MS);
    const requestsAfterAbort = logRequests;

    await sleep(UPSTREAM_DELAY_MS * 4);

    expect(logRequests).to.equal(requestsAfterAbort);
    expect(logRequests).to.be.at.most(UPSTREAM_MAX_SOCKETS * 2 * abortedRequests);
  });

  it('serves a batch request in full when the client waits for the response', async function () {
    const response = await relayClient.post('/', getBatchPayload(60));

    expect(response.status).to.equal(200);
    expect(response.data).to.have.lengthOf(BATCH_SIZE);
    expect(response.data.every((entry: { result: unknown }) => Array.isArray(entry.result))).to.equal(true);
    expect(logRequests).to.equal(ADDRESS_COUNT);
  });

  it('stops the downstream fan-out when the client aborts a batch request', async function () {
    await sendBatchAndAbort(70);

    await sleep(ABORT_SETTLE_MS);
    const requestsAfterAbort = logRequests;

    await sleep(UPSTREAM_DELAY_MS * 4);
    expect(logRequests).to.equal(requestsAfterAbort);
    expect(logRequests).to.be.at.most(UPSTREAM_MAX_SOCKETS * 2);
  });

  it('leaves no unhandled rejection behind when a batch request is abandoned', async function () {
    const unhandled: string[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(String(reason));
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      await sendBatchAndAbort(80);
      await sleep(UPSTREAM_DELAY_MS * 4);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    expect(unhandled).to.deep.equal([]);
  });

  it('keeps serving unrelated requests while requests are being abandoned', async function () {
    const aborted = Promise.all(Array.from({ length: 5 }, (_, i) => sendAndAbort(20 + i)));
    const control = await relayClient.post('/', {
      jsonrpc: '2.0',
      id: 30,
      method: 'eth_chainId',
      params: [],
    });
    await aborted;

    expect(control.status).to.equal(200);
    expect(control.data.result).to.equal(ConfigService.get('CHAIN_ID'));
  });

  it('serves a full request normally after the aborted ones', async function () {
    await Promise.all(Array.from({ length: 5 }, (_, i) => sendAndAbort(40 + i)));
    await sleep(UPSTREAM_DELAY_MS * 2);
    logRequests = 0;

    const response = await relayClient.post('/', getLogsPayload(50));

    expect(response.status).to.equal(200);
    expect(response.data.result).to.deep.equal([]);
    expect(logRequests).to.equal(ADDRESS_COUNT);
  });
});
