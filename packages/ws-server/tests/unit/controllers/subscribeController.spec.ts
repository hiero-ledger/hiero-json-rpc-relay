// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { MirrorNodeClient } from '@hashgraph/json-rpc-relay/dist/lib/clients/mirrorNodeClient';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { Relay } from '@hashgraph/json-rpc-relay/dist/lib/relay';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types/RequestDetails';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import { expect } from 'chai';
import Koa from 'koa';
import { Counter } from 'prom-client';
import sinon from 'sinon';

import { contractAddress1, contractAddress2 } from '../../../../relay/tests/helpers';
import Assertions from '../../../../server/tests/helpers/assertions';
import { handleEthSubscribe } from '../../../dist/controllers/subscribeController';
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

describe('Subscribe Controller', function () {
  const nonExistingMethod = 'non-existing-method';
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
      info: sinon.stub(),
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

  describe('handleEthSubscribe', async function () {
    it('should not be able to subscribe if SUBSCRIPTIONS_ENABLED is disabled', async function () {
      stubConfigService.withArgs('SUBSCRIPTIONS_ENABLED').returns(false);

      const resp = await handleEthSubscribe({
        request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
        method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
        params: [constants.SUBSCRIBE_EVENTS.NEW_HEADS, {}],
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

    it('should be able to subscribe for logs ', async function () {
      stubSubscriptionService.subscribe.returns(subscriptionId);

      const resp = await handleEthSubscribe({
        request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
        method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
        params: [constants.SUBSCRIBE_EVENTS.LOGS, {}],
        relay: stubRelay,
        logger: mockLogger,
        limiter: stubConnectionLimiter,
        mirrorNodeClient: stubMirrorNodeClient,
        ctx: createMockContext(),
        requestDetails: requestDetails,
        subscriptionService: stubSubscriptionService,
      });

      expect(resp.result).to.equal(subscriptionId);
    });

    it('should not be able to subscribe for logs when multiple addresses are provided as filter ', async function () {
      stubMirrorNodeClient.resolveEntityType.returns(true);
      stubSubscriptionService.subscribe.returns(subscriptionId);

      try {
        await handleEthSubscribe({
          request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
          method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
          params: [constants.SUBSCRIBE_EVENTS.LOGS, { address: [contractAddress1, contractAddress2] }],
          relay: stubRelay,
          logger: mockLogger,
          limiter: stubConnectionLimiter,
          mirrorNodeClient: stubMirrorNodeClient,
          ctx: createMockContext(),
          requestDetails: requestDetails,
          subscriptionService: stubSubscriptionService,
        });
        Assertions.expectedError();
      } catch (e) {
        expect(e.code).to.equal(-32602);
      }
    });

    it('should not be able to subscribe to new heads if WS_NEW_HEADS_ENABLED is disabled', async function () {
      stubConfigService.withArgs('WS_NEW_HEADS_ENABLED').returns(false);

      try {
        await handleEthSubscribe({
          request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
          method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
          params: [constants.SUBSCRIBE_EVENTS.NEW_HEADS, {}],
          relay: stubRelay,
          logger: mockLogger,
          limiter: stubConnectionLimiter,
          mirrorNodeClient: stubMirrorNodeClient,
          ctx: createMockContext(),
          requestDetails: requestDetails,
          subscriptionService: stubSubscriptionService,
        });
        Assertions.expectedError();
      } catch (e: any) {
        expect(e.code).to.equal(-32601);
      }
    });

    it('should be able to subscribe to new heads', async function () {
      stubSubscriptionService.subscribe.returns(subscriptionId);
      stubConfigService.withArgs('WS_NEW_HEADS_ENABLED').returns(true);

      const resp = await handleEthSubscribe({
        request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
        method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
        params: [constants.SUBSCRIBE_EVENTS.NEW_HEADS, {}],
        relay: stubRelay,
        logger: mockLogger,
        limiter: stubConnectionLimiter,
        mirrorNodeClient: stubMirrorNodeClient,
        ctx: createMockContext(),
        requestDetails: requestDetails,
        subscriptionService: stubSubscriptionService,
      });

      expect(resp.result).to.equal(subscriptionId);
    });

    it('should throw unsupported method for non-existing method', async function () {
      try {
        await handleEthSubscribe({
          request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
          method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
          params: [nonExistingMethod, {}],
          relay: stubRelay,
          logger: mockLogger,
          limiter: stubConnectionLimiter,
          mirrorNodeClient: stubMirrorNodeClient,
          ctx: createMockContext(),
          requestDetails: requestDetails,
          subscriptionService: stubSubscriptionService,
        });
      } catch (e: any) {
        expect(e.code).to.equal(-32601);
      }
    });
  });
});
