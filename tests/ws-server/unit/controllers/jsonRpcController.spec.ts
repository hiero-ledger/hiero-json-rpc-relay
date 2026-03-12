// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import Koa from 'koa';
import { Counter } from 'prom-client';
import sinon from 'sinon';

import { getRequestResult } from '../../../../dist/ws-server/controllers/jsonRpcController';
import WsMetricRegistry from '../../../../dist/ws-server/metrics/wsMetricRegistry';
import { SubscriptionService } from '../../../../dist/ws-server/service/subscriptionService';
import { MirrorNodeClient } from '../../../../src/relay/lib/clients/mirrorNodeClient';
import { predefined } from '../../../../src/relay/lib/errors/JsonRpcError';
import { Relay } from '../../../../src/relay/lib/relay';
import { RequestDetails } from '../../../../src/relay/lib/types/RequestDetails';
import { IJsonRpcRequest } from '../../../../src/server/koaJsonRpc/lib/IJsonRpcRequest';
import ConnectionLimiter from '../../../../src/ws-server/metrics/connectionLimiter';
import { WS_CONSTANTS } from '../../../../src/ws-server/utils/constants';

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

describe('JSON Rpc Controller', function () {
  let mockLogger: any;
  let stubWsMetricRegistry: WsMetricRegistry;
  let stubRelay: Relay;
  let stubConnectionLimiter: ConnectionLimiter;
  let stubMirrorNodeClient: MirrorNodeClient;
  let stubSubscriptionService: SubscriptionService;
  let requestDetails: RequestDetails;

  beforeEach(() => {
    mockLogger = {
      warn: sinon.stub(),
      trace: sinon.stub(),
      isLevelEnabled: sinon.stub().returns(true),
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
    requestDetails = new RequestDetails({
      requestId: '3',
      ipAddress: '0.0.0.0',
      connectionId: '9',
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getRequestResult', async function () {
    let defaultRequestParams: any;

    beforeEach(() => {
      defaultRequestParams = [
        createMockContext(),
        stubRelay,
        mockLogger,
        { id: '2', method: WS_CONSTANTS.METHODS.ETH_CHAINID, jsonrpc: '2.0' } as IJsonRpcRequest,
        stubConnectionLimiter,
        stubMirrorNodeClient,
        stubWsMetricRegistry,
        requestDetails,
        stubSubscriptionService,
      ];
    });

    it('should throw invalid request if id is missing from request body', async function () {
      defaultRequestParams[3] = { method: WS_CONSTANTS.METHODS.ETH_CHAINID, jsonrpc: '2.0' } as IJsonRpcRequest;
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32600);
      expect(resp.error.message).to.include('Invalid Request');
    });

    it('should throw method not found if passed method is not existing', async function () {
      const nonExistingMethod = 'eth_non-existing-method';
      defaultRequestParams[3] = { id: '2', method: nonExistingMethod, jsonrpc: '2.0' } as IJsonRpcRequest;
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32601);
      expect(resp.error.message).to.include(`Method ${nonExistingMethod} not found`);
    });

    it('should throw IP Rate Limit exceeded error if .shouldRateLimitOnMethod returns true', async function () {
      stubConnectionLimiter.shouldRateLimitOnMethod.returns(true);
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32605);
      expect(resp.error.message).to.include('IP Rate limit exceeded');
    });

    it('should throw Max Subscription error if subscription limit is reached', async function () {
      stubConnectionLimiter.validateSubscriptionLimit.returns(false);
      defaultRequestParams[3] = {
        id: '2',
        method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
        jsonrpc: '2.0',
      } as IJsonRpcRequest;
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32608);
      expect(resp.error.message).to.include('Exceeded maximum allowed subscriptions');
    });

    it('should throw error on eth_subscribe if WS Subscriptions are disabled', async function () {
      stubConnectionLimiter.validateSubscriptionLimit.returns(true);
      defaultRequestParams[3] = {
        id: '2',
        method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
        jsonrpc: '2.0',
      } as IJsonRpcRequest;
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32207);
      expect(resp.error.message).to.include('WS Subscriptions are disabled');
    });

    it('should throw error on eth_unsubscribe if WS Subscriptions are disabled', async function () {
      stubConnectionLimiter.validateSubscriptionLimit.returns(true);
      defaultRequestParams[3] = {
        id: '2',
        method: WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE,
        jsonrpc: '2.0',
      } as IJsonRpcRequest;
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32207);
      expect(resp.error.message).to.include('WS Subscriptions are disabled');
    });

    it('should be able to execute `eth_chainId` and get a proper response', async function () {
      const chainId = '0x12a';
      stubRelay.executeRpcMethod.returns(chainId);
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.result).to.equal(chainId);
    });

    it('should be able to handle the error as JsonRpcError if an internal error is thrown within the relay execution', async function () {
      stubRelay.executeRpcMethod.throws(predefined.INTERNAL_ERROR);
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32603);
      expect(resp.error.message).to.include('Unknown error invoking RPC');
    });

    it('should transform every error to JsonRpcError`', async function () {
      delete mockLogger.isLevelEnabled;

      stubRelay.executeRpcMethod.throws(new Error('custom error'));
      const resp = await getRequestResult(...defaultRequestParams);

      expect(resp.error.code).to.equal(-32603);
    });
  });
});
