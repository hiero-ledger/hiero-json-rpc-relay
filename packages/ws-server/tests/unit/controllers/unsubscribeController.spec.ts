// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { MirrorNodeClient } from '@hashgraph/json-rpc-relay/dist/lib/clients/mirrorNodeClient';
import { Relay } from '@hashgraph/json-rpc-relay/dist/lib/relay';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types/RequestDetails';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import { expect } from 'chai';
import Koa from 'koa';
import { Counter } from 'prom-client';
import sinon from 'sinon';

import { handleEthUnsubscribe } from '../../../dist/controllers/unsubscribeController';
import WsMetricRegistry from '../../../dist/metrics/wsMetricRegistry';
import { SubscriptionService } from '../../../dist/service/subscriptionService';
import ConnectionLimiter from '../../../src/metrics/connectionLimiter';
import { WS_CONSTANTS } from '../../../src/utils/constants';

function createMockContext(): Koa.Context {
  return {
    websocket: {
      id: 'test-connection-id',
      send: sinon.stub(),
      close: sinon.stub(),
      inactivityTTL: undefined,
      ipCounted: false,
      subscriptions: 0,
    },
    request: { ip: '127.0.0.1' },
    app: { server: { _connections: 0 } },
  } as Koa.Context;
}

describe('Unsubscribe Controller', function () {
  const subscriptionId = '5644';

  let mockLogger: any;
  let stubWsMetricRegistry: WsMetricRegistry;
  let stubRelay: Relay;
  let stubConnectionLimiter: ConnectionLimiter;
  let stubMirrorNodeClient: MirrorNodeClient;
  let stubSubscriptionService: SubscriptionService;
  let stubConfigService: ConfigService;
  let requestDetails: RequestDetails;

  beforeEach(() => {
    mockLogger = {
      warn: sinon.stub(),
    };
    stubWsMetricRegistry = sinon.createStubInstance(WsMetricRegistry);
    stubWsMetricRegistry.getCounter.returns({
      labels: () => {
        return { inc: sinon.stub() };
      },
    } as unknown as Counter);
    stubRelay = sinon.createStubInstance(Relay);
    stubConnectionLimiter = sinon.createStubInstance(ConnectionLimiter);
    stubMirrorNodeClient = sinon.createStubInstance(MirrorNodeClient);
    stubSubscriptionService = sinon.createStubInstance(SubscriptionService);
    stubConfigService = sinon.stub(ConfigService, 'get');
    stubConfigService.withArgs('SUBSCRIPTIONS_ENABLED').returns(true);
    requestDetails = new RequestDetails({
      requestId: '3',
      ipAddress: '0.0.0.0',
      connectionId: '9',
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('handleEthUnsubscribe', async function () {
    it('should not be able to unsubscribe if SUBSCRIPTIONS_ENABLED is disabled', async function () {
      stubConfigService.withArgs('SUBSCRIPTIONS_ENABLED').returns(false);

      const resp = await handleEthUnsubscribe({
        request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
        method: WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE,
        params: [subscriptionId],
        relay: stubRelay,
        logger: mockLogger,
        limiter: stubConnectionLimiter,
        mirrorNodeClient: stubMirrorNodeClient,
        ctx: createMockContext(),
        requestDetails: requestDetails,
        subscriptionService: stubSubscriptionService,
      });

      expect(resp.error.code).to.equal(-32207);
      expect(resp.error.message).to.contain('WS Subscriptions are disabled');
    });

    it('should be able to unsubscribe', async function () {
      stubSubscriptionService.unsubscribe.returns(subscriptionId);

      const resp = await handleEthUnsubscribe({
        request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
        method: WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE,
        params: [subscriptionId],
        relay: stubRelay,
        logger: mockLogger,
        limiter: stubConnectionLimiter,
        mirrorNodeClient: stubMirrorNodeClient,
        ctx: createMockContext(),
        requestDetails: requestDetails,
        subscriptionService: stubSubscriptionService,
      });

      expect(resp.result).to.be.true;
    });
  });
});
