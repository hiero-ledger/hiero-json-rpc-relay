// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { type Logger } from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { createMethodMetricLabeler, UNKNOWN_METHOD_LABEL } from '../../../../src/metrics';
import { Relay } from '../../../../src/relay/lib/relay';
import { type RateLimitStore } from '../../../../src/relay/lib/types';
import KoaJsonRpc from '../../../../src/server/koaJsonRpc';
import { type IJsonRpcRequest } from '../../../../src/server/koaJsonRpc/lib/IJsonRpcRequest';
import { type IJsonRpcResponse } from '../../../../src/server/koaJsonRpc/lib/RpcResponse';

describe('KoaJsonRpc rate-limit method labels', function () {
  let stubRelay: sinon.SinonStubbedInstance<Relay>;
  let koaJsonRpc: KoaJsonRpc;
  let shouldRateLimit: sinon.SinonStub;

  const callGetRequestResult = (method: string): Promise<IJsonRpcResponse> =>
    koaJsonRpc.getRequestResult({ id: '1', method, jsonrpc: '2.0' } as IJsonRpcRequest, '127.0.0.1', 'req-1');

  beforeEach(() => {
    stubRelay = sinon.createStubInstance(Relay);
    stubRelay.rpcMethodRegistry = new Map([['eth_chainId', sinon.stub()]]);
    // Real labeler with a small cap so overflow unknowns collapse to the shared "unknown" bucket.
    stubRelay.methodMetricLabeler = sinon
      .stub<[unknown], string>()
      .callsFake(createMethodMetricLabeler(['eth_chainId'], 2));
    stubRelay.executeRpcMethod.resolves('0x1');

    const logger = { debug: sinon.stub(), trace: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
    koaJsonRpc = new KoaJsonRpc(logger, new Registry(), stubRelay, {} as RateLimitStore);

    // Replace the real limiter so the test observes the method value the gate hands it.
    shouldRateLimit = sinon.stub().resolves(false);
    (koaJsonRpc as unknown as { rateLimiter: { shouldRateLimit: sinon.SinonStub } }).rateLimiter = { shouldRateLimit };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('rate limits a registered method under its own name', async function () {
    await callGetRequestResult('eth_chainId');

    expect(shouldRateLimit.calledOnceWith('127.0.0.1', 'eth_chainId')).to.be.true;
  });

  it('still rate limits caller-invented method names, but under a bounded set of labels', async function () {
    for (let i = 0; i < 25; i++) {
      await callGetRequestResult(`eth_invented${i}`);
    }

    // Every request is still rate limited, but the distinct labels reaching the limiter stay bounded.
    const limitedMethods = new Set(shouldRateLimit.getCalls().map((call) => call.args[1]));
    expect(shouldRateLimit.callCount).to.equal(25);
    expect(limitedMethods.size).to.be.at.most(3); // the 2 tracked names plus the shared "unknown"
    expect(limitedMethods.has(UNKNOWN_METHOD_LABEL)).to.be.true;
  });
});
