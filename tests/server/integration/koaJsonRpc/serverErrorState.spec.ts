// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import http from 'http';
import Koa from 'koa';
import { type AddressInfo } from 'net';
import { type Logger } from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { predefined } from '../../../../src/relay/lib/errors/JsonRpcError';
import { Relay } from '../../../../src/relay/lib/relay';
import { type RateLimitStore } from '../../../../src/relay/lib/types';
import KoaJsonRpc from '../../../../src/server/koaJsonRpc';

/**
 * The HTTP access log is written at `INFO` only for server errors, which `ctx.state.serverError` marks.
 */
describe('KoaJsonRpc server error state', function () {
  this.timeout(10000);

  let server: http.Server;
  let port: number;
  let executeRpcMethod: sinon.SinonStub;
  let state: Record<string, unknown>;

  const post = (body: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(JSON.parse(data)));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });

  const request = { id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] };

  beforeEach(async () => {
    state = {};
    const stubRelay = sinon.createStubInstance(Relay);
    stubRelay.rpcMethodRegistry = new Map([['eth_chainId', sinon.stub()]]);
    stubRelay.methodMetricLabeler = sinon.stub<[unknown], string>().returnsArg(0);
    executeRpcMethod = stubRelay.executeRpcMethod;

    const logger = { debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
    const koaJsonRpc = new KoaJsonRpc(logger, new Registry(), stubRelay, {} as RateLimitStore);
    (koaJsonRpc as unknown as { rateLimiter: { shouldRateLimit: sinon.SinonStub } }).rateLimiter = {
      shouldRateLimit: sinon.stub().resolves(false),
    };

    const app = new Koa();
    app.use(async (ctx, next) => {
      ctx.state.reqId = 'test-request';
      await next();
      state = { ...ctx.state };
    });
    app.use(koaJsonRpc.rpcApp());

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    sinon.restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('marks a server error', async () => {
    executeRpcMethod.resolves(predefined.INTERNAL_ERROR('boom'));

    const response = await post(request);

    expect(response).to.have.nested.property('error.code', -32603);
    expect(response).to.not.have.nested.property('error.clientError');
    expect(state.serverError).to.equal(true);
  });

  it('does not mark a client error', async () => {
    executeRpcMethod.resolves(predefined.CONTRACT_REVERT('boom'));

    await post(request);

    expect(state.serverError).to.equal(false);
  });

  it('does not mark a successful request', async () => {
    executeRpcMethod.resolves('0x12a');

    await post(request);

    expect(state).to.not.have.property('serverError');
  });
});
