// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import pino from 'pino';
import { type Counter, Registry } from 'prom-client';
import sinon from 'sinon';

import { MirrorNodeClient } from '../../../src/relay/lib/clients/mirrorNodeClient';
import constants from '../../../src/relay/lib/constants';
import { predefined } from '../../../src/relay/lib/errors/JsonRpcError';
import { Relay } from '../../../src/relay/lib/relay';
import { IPRateLimiterService } from '../../../src/relay/lib/services';
import { RequestDetails } from '../../../src/relay/lib/types/RequestDetails';
import { type IJsonRpcRequest } from '../../../src/server/koaJsonRpc/lib/IJsonRpcRequest';
import { type IJsonRpcResponse } from '../../../src/server/koaJsonRpc/lib/RpcResponse';
import { getRequestResult } from '../../../src/ws-server/controllers/jsonRpcController';
import ConnectionLimiter from '../../../src/ws-server/metrics/connectionLimiter';
import WsMetricRegistry from '../../../src/ws-server/metrics/wsMetricRegistry';
import { type PollerService } from '../../../src/ws-server/service/pollerService';
import { SubscriptionService } from '../../../src/ws-server/service/subscriptionService';
import { type WsContext } from '../../../src/ws-server/types';
import { WS_CONSTANTS } from '../../../src/ws-server/utils/constants';
import { overrideEnvsInMochaDescribe } from '../../relay/helpers';

const logger = pino({ level: 'silent' });

interface SubscriptionServiceInternals {
  pollerService: PollerService;
}

const topic = (nonce: number): string => `0x${nonce.toString(16).padStart(64, '0')}`;

function createMockContext(limiter: ConnectionLimiter): WsContext {
  return {
    ip: '127.0.0.1',
    websocket: {
      id: 'test-connection-id',
      send: sinon.stub(),
      close: sinon.stub(),
      subscriptions: 0,
      limiter,
    },
    request: { ip: '127.0.0.1' },
    app: { server: { _connections: 1 } },
  } as unknown as WsContext;
}

const isError = (response: IJsonRpcResponse): boolean => 'error' in response;

describe('Subscription limit enforcement', function () {
  const SUBSCRIPTION_LIMIT = 10;

  let ctx: WsContext;
  let limiter: ConnectionLimiter;
  let subscriptionService: SubscriptionService;
  let stubRelay: sinon.SinonStubbedInstance<Relay>;
  let stubMirrorNodeClient: sinon.SinonStubbedInstance<MirrorNodeClient>;
  let stubWsMetricRegistry: sinon.SinonStubbedInstance<WsMetricRegistry>;
  let requestDetails: RequestDetails;

  overrideEnvsInMochaDescribe({ WS_SUBSCRIPTION_LIMIT: SUBSCRIPTION_LIMIT, WS_NEW_HEADS_ENABLED: true });

  beforeEach(() => {
    stubRelay = sinon.createStubInstance(Relay);
    stubRelay.rpcMethodRegistry = new Map();
    stubMirrorNodeClient = sinon.createStubInstance(MirrorNodeClient);
    stubWsMetricRegistry = sinon.createStubInstance(WsMetricRegistry);
    stubWsMetricRegistry.getCounter.returns({
      labels: () => ({ inc: sinon.stub() }),
    } as unknown as Counter);

    limiter = new ConnectionLimiter(logger, new Registry(), sinon.createStubInstance(IPRateLimiterService));
    subscriptionService = new SubscriptionService(stubRelay, logger, new Registry());
    const internals = subscriptionService as unknown as SubscriptionServiceInternals;
    sinon.stub(internals.pollerService, 'add');
    sinon.stub(internals.pollerService, 'remove');

    ctx = createMockContext(limiter);
    requestDetails = new RequestDetails({ requestId: '1', ipAddress: '127.0.0.1', connectionId: '1' });
  });

  afterEach(() => {
    sinon.restore();
  });

  const subscribeRequest = (id: number, params: unknown[]): IJsonRpcRequest =>
    ({ id: `${id}`, jsonrpc: '2.0', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, params }) as IJsonRpcRequest;

  const dispatch = (request: IJsonRpcRequest): Promise<IJsonRpcResponse> =>
    getRequestResult(
      ctx,
      stubRelay,
      logger,
      request,
      limiter,
      stubMirrorNodeClient,
      stubWsMetricRegistry,
      requestDetails,
      subscriptionService,
    );

  const assertAdmittedExactlyTheLimit = (responses: IJsonRpcResponse[]): void => {
    const admitted = responses.filter((response) => !isError(response));
    const refused = responses.filter(isError);

    expect(admitted).to.have.lengthOf(SUBSCRIPTION_LIMIT);
    expect(new Set(admitted.map((response) => (response as { result: string }).result)).size).to.eq(SUBSCRIPTION_LIMIT);
    expect(refused).to.have.lengthOf(responses.length - SUBSCRIPTION_LIMIT);
    for (const response of refused) {
      expect((response as { error: { code: number } }).error.code).to.eq(predefined.MAX_SUBSCRIPTIONS.code);
    }
    expect(ctx.websocket.subscriptions).to.eq(SUBSCRIPTION_LIMIT);
  };

  const uniqueLogsSubscribes = (count: number): IJsonRpcRequest[] =>
    Array.from({ length: count }, (_, i) =>
      subscribeRequest(i, [constants.SUBSCRIBE_EVENTS.LOGS, { topics: [topic(i)] }]),
    );

  it('admits exactly the limit for a batch of unique logs filters', async function () {
    const responses = await Promise.all(uniqueLogsSubscribes(20).map(dispatch));

    assertAdmittedExactlyTheLimit(responses);
  });

  it('admits exactly the limit for unique logs filters arriving as frames in one tick', async function () {
    const inFlight: Promise<IJsonRpcResponse>[] = [];
    for (const request of uniqueLogsSubscribes(20)) {
      inFlight.push(dispatch(request));
    }

    assertAdmittedExactlyTheLimit(await Promise.all(inFlight));
  });

  it('counts repeat subscribes to the same filter once', async function () {
    const filters = { topics: [topic(1)] };
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => dispatch(subscribeRequest(i, [constants.SUBSCRIBE_EVENTS.LOGS, filters]))),
    );

    const subscriptionIds = new Set(responses.map((response) => (response as { result: string }).result));
    expect(responses.some(isError)).to.be.false;
    expect(subscriptionIds.size).to.eq(1);
    expect(ctx.websocket.subscriptions).to.eq(1);
  });

  it('releases the slot on eth_unsubscribe so a later subscribe is admitted', async function () {
    const responses = await Promise.all(uniqueLogsSubscribes(SUBSCRIPTION_LIMIT).map(dispatch));
    const subscriptionId = (responses[0] as { result: string }).result;

    const unsubscribe = await dispatch({
      id: 'u',
      jsonrpc: '2.0',
      method: WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE,
      params: [subscriptionId],
    } as IJsonRpcRequest);
    expect((unsubscribe as { result: boolean }).result).to.be.true;
    expect(ctx.websocket.subscriptions).to.eq(SUBSCRIPTION_LIMIT - 1);

    const resubscribe = await dispatch(
      subscribeRequest(99, [constants.SUBSCRIBE_EVENTS.LOGS, { topics: [topic(99)] }]),
    );
    expect(isError(resubscribe)).to.be.false;
    expect(ctx.websocket.subscriptions).to.eq(SUBSCRIPTION_LIMIT);
  });

  describe('newHeads', function () {
    const NEW_HEADS_LIMIT = 2;

    overrideEnvsInMochaDescribe({ WS_SUBSCRIPTION_LIMIT: NEW_HEADS_LIMIT });

    const newHeadsParams = [
      [constants.SUBSCRIBE_EVENTS.NEW_HEADS],
      [constants.SUBSCRIBE_EVENTS.NEW_HEADS, { includeTransactions: true }],
      [constants.SUBSCRIBE_EVENTS.NEW_HEADS, { includeTransactions: false }],
    ];

    it('still caps distinct subscriptions at the limit', async function () {
      const responses = await Promise.all(newHeadsParams.map((params, i) => dispatch(subscribeRequest(i, params))));

      expect(responses.filter((response) => !isError(response))).to.have.lengthOf(NEW_HEADS_LIMIT);
      expect((responses[2] as { error: { code: number } }).error.code).to.eq(predefined.MAX_SUBSCRIPTIONS.code);
      expect(ctx.websocket.subscriptions).to.eq(NEW_HEADS_LIMIT);
    });
  });
});
