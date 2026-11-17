// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import http from 'http';
import Koa from 'koa';
import { type AddressInfo } from 'net';
import { type Logger } from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { ConfigService } from '../../../../src/config-service/services';
import { Relay } from '../../../../src/relay/lib/relay';
import { type RateLimitStore, RequestDetails } from '../../../../src/relay/lib/types';
import {
  type GetLogsMemoryShare,
  sharedGetLogsMemoryBudget,
} from '../../../../src/relay/lib/utils/getLogsMemoryBudget';
import KoaJsonRpc from '../../../../src/server/koaJsonRpc';

describe('KoaJsonRpc response memory share', function () {
  this.timeout(10000);

  let server: http.Server;
  let port: number;
  let seen: RequestDetails[];
  let executeRpcMethod: sinon.SinonStub;
  let closedBeforeResponseWritten: boolean | undefined;

  const post = (body: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(JSON.parse(data)));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });

  const request = (id: number): Record<string, unknown> => ({ id, jsonrpc: '2.0', method: 'eth_chainId', params: [] });

  // the share is closed on the response's 'close' event, which can come just after the client has the body
  const waitUntilClosed = async (share: GetLogsMemoryShare): Promise<void> => {
    for (let i = 0; i < 50 && !share.isExceeded; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  beforeEach(async () => {
    seen = [];
    closedBeforeResponseWritten = undefined;

    const stubRelay = sinon.createStubInstance(Relay);
    stubRelay.rpcMethodRegistry = new Map([['eth_chainId', sinon.stub()]]);
    stubRelay.methodMetricLabeler = sinon.stub<[unknown], string>().returnsArg(0);
    executeRpcMethod = stubRelay.executeRpcMethod.callsFake(async (_method, _params, requestDetails) => {
      seen.push(requestDetails);
      requestDetails.responseMemoryShare?.consume(10);
      return '0x12a';
    });

    const logger = { debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
    const koaJsonRpc = new KoaJsonRpc(logger, new Registry(), stubRelay, {} as RateLimitStore);
    (koaJsonRpc as unknown as { rateLimiter: { shouldRateLimit: sinon.SinonStub } }).rateLimiter = {
      shouldRateLimit: sinon.stub().resolves(false),
    };

    const app = new Koa();
    app.use(async (ctx, next) => {
      ctx.state.reqId = 'test-request';
      await next();
      // rpcApp has returned, but Koa has not written the response yet
      closedBeforeResponseWritten = seen[0]?.responseMemoryShare?.isExceeded;
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

  it('gives a single request its own share and closes it only after the response is written', async () => {
    const usedBefore = sharedGetLogsMemoryBudget().usedBytes;

    const response = await post(request(1));
    const share = seen[0].responseMemoryShare!;
    await waitUntilClosed(share);

    expect(response).to.deep.include({ id: 1, result: '0x12a' });
    expect(closedBeforeResponseWritten).to.equal(false);
    expect(share.isExceeded).to.equal(true);
    expect(share.heldBytes).to.equal(0);
    expect(sharedGetLogsMemoryBudget().usedBytes).to.equal(usedBefore);
  });

  it('gives every entry of a batch the same share and closes it once after the batch response', async () => {
    const usedBefore = sharedGetLogsMemoryBudget().usedBytes;

    const response = (await post([request(1), request(2), request(3)])) as unknown[];
    const share = seen[0].responseMemoryShare!;
    await waitUntilClosed(share);

    expect(response).to.have.length(3);
    expect(seen).to.have.length(3);
    expect(seen[1].responseMemoryShare).to.equal(share);
    expect(seen[2].responseMemoryShare).to.equal(share);
    expect(closedBeforeResponseWritten).to.equal(false);
    expect(share.isExceeded).to.equal(true);
    expect(sharedGetLogsMemoryBudget().usedBytes).to.equal(usedBefore);
  });

  it('gives separate requests separate shares', async () => {
    await post(request(1));
    await post(request(2));

    expect(seen[0].responseMemoryShare).to.not.equal(seen[1].responseMemoryShare);
  });

  it('closes the share when the client disconnects before the response', async () => {
    const usedBefore = sharedGetLogsMemoryBudget().usedBytes;
    let finishCall!: () => void;
    const callStarted = new Promise<void>((started) => {
      executeRpcMethod.callsFake(async (_method, _params, requestDetails) => {
        seen.push(requestDetails);
        requestDetails.responseMemoryShare?.consume(10);
        started();
        await new Promise<void>((resolve) => (finishCall = resolve));
        return '0x12a';
      });
    });

    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/' });
    req.on('error', () => {});
    req.end(JSON.stringify(request(1)));
    await callStarted;

    const share = seen[0].responseMemoryShare!;
    expect(sharedGetLogsMemoryBudget().usedBytes).to.equal(usedBefore + 10);

    req.destroy();
    await waitUntilClosed(share);

    expect(share.isExceeded).to.equal(true);
    expect(sharedGetLogsMemoryBudget().usedBytes).to.equal(usedBefore);
    finishCall();
  });

  it('keeps the share out of what is copied to a worker thread', () => {
    const share = sharedGetLogsMemoryBudget().open();
    const requestDetails = new RequestDetails({ requestId: 'x', ipAddress: '0.0.0.0', responseMemoryShare: share });

    expect(requestDetails.responseMemoryShare).to.equal(share);
    expect(Object.keys(requestDetails)).to.not.include('responseMemoryShare');
    expect(structuredClone(requestDetails)).to.not.have.property('responseMemoryShare');
    share.close();
  });

  it('uses one budget per process, sized by ETH_GET_LOGS_RELAY_MAX_RESPONSE_SIZE', () => {
    const budget = sharedGetLogsMemoryBudget();
    const limit: number = ConfigService.get('ETH_GET_LOGS_RELAY_MAX_RESPONSE_SIZE');
    const full = budget.open();
    const next = budget.open();

    expect(sharedGetLogsMemoryBudget()).to.equal(budget);

    full.consume(limit - budget.usedBytes);
    expect(() => next.consume(1)).to.throw();

    full.close();
    next.close();
  });
});
