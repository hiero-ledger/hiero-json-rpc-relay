// SPDX-License-Identifier: Apache-2.0
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { type Logger } from 'pino';
import { type Counter } from 'prom-client';
import sinon from 'sinon';

import { ConfigService } from '../../../../src/config-service/services';
import { MirrorNodeClient } from '../../../../src/relay/lib/clients/mirrorNodeClient';
import constants from '../../../../src/relay/lib/constants';
import { Relay } from '../../../../src/relay/lib/relay';
import { RequestDetails } from '../../../../src/relay/lib/types/RequestDetails';
import { type IJsonRpcRequest } from '../../../../src/server/koaJsonRpc/lib/IJsonRpcRequest';
import { type ISharedParams } from '../../../../src/ws-server/controllers/jsonRpcController';
import { handleEthSubscribe } from '../../../../src/ws-server/controllers/subscribeController';
import ConnectionLimiter from '../../../../src/ws-server/metrics/connectionLimiter';
import WsMetricRegistry from '../../../../src/ws-server/metrics/wsMetricRegistry';
import { SubscriptionService } from '../../../../src/ws-server/service/subscriptionService';
import { type WsContext } from '../../../../src/ws-server/types';
import { WS_CONSTANTS } from '../../../../src/ws-server/utils/constants';
import { contractAddress1, contractAddress2 } from '../../../relay/helpers';
import { assertJsonRpcError, assertJsonRpcResult } from '../../helper';
chai.use(chaiAsPromised);

function createMockContext(): WsContext {
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
  } as unknown as WsContext;
}

describe('Subscribe Controller', function () {
  const nonExistingMethod = 'non-existing-method';
  const subscriptionId = '5644';

  let mockLogger: { warn: sinon.SinonStub; info: sinon.SinonStub };
  let stubWsMetricRegistry: sinon.SinonStubbedInstance<WsMetricRegistry>;
  let stubRelay: sinon.SinonStubbedInstance<Relay>;
  let stubConnectionLimiter: sinon.SinonStubbedInstance<ConnectionLimiter>;
  let stubMirrorNodeClient: sinon.SinonStubbedInstance<MirrorNodeClient>;
  let stubSubscriptionService: sinon.SinonStubbedInstance<SubscriptionService>;
  let stubConfigService: sinon.SinonStub;
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
    let defaultParams: ISharedParams;

    beforeEach(() => {
      defaultParams = {
        request: { id: '2', method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE, jsonrpc: '2.0' } as IJsonRpcRequest,
        method: WS_CONSTANTS.METHODS.ETH_SUBSCRIBE,
        params: [constants.SUBSCRIBE_EVENTS.NEW_HEADS, {}],
        relay: stubRelay,
        logger: mockLogger as unknown as Logger,
        limiter: stubConnectionLimiter,
        mirrorNodeClient: stubMirrorNodeClient,
        ctx: createMockContext(),
        requestDetails: requestDetails,
        subscriptionService: stubSubscriptionService,
      };
    });

    it('should not be able to subscribe if SUBSCRIPTIONS_ENABLED is disabled', async function () {
      stubConfigService.withArgs('SUBSCRIPTIONS_ENABLED').returns(false);
      const resp = await handleEthSubscribe(defaultParams);

      assertJsonRpcError(resp);

      expect(resp.error.code).to.equal(-32207);
      expect(resp.error.message).to.contain('WS Subscriptions are disabled');
    });

    it('should be able to subscribe for logs ', async function () {
      stubSubscriptionService.subscribe.returns(subscriptionId);
      const resp = await handleEthSubscribe({
        ...defaultParams,
        params: [constants.SUBSCRIBE_EVENTS.LOGS, {}],
      });

      assertJsonRpcResult(resp);

      expect(resp.result).to.equal(subscriptionId);
    });

    it('should not be able to subscribe for logs when multiple addresses are provided as filter ', async function () {
      stubMirrorNodeClient.resolveEntityType.resolves({ type: constants.TYPE_CONTRACT, entity: {} });
      stubSubscriptionService.subscribe.returns(subscriptionId);

      await expect(
        handleEthSubscribe({
          ...defaultParams,
          params: [constants.SUBSCRIBE_EVENTS.LOGS, { address: [contractAddress1, contractAddress2] }],
        }),
      ).to.be.eventually.rejected.and.have.property('code', -32602);
    });

    it('should not be able to subscribe to new heads if WS_NEW_HEADS_ENABLED is disabled', async function () {
      stubConfigService.withArgs('WS_NEW_HEADS_ENABLED').returns(false);

      await expect(handleEthSubscribe(defaultParams)).to.be.eventually.rejected.and.have.property('code', -32601);
    });

    it('should be able to subscribe to new heads', async function () {
      stubSubscriptionService.subscribe.returns(subscriptionId);
      stubConfigService.withArgs('WS_NEW_HEADS_ENABLED').returns(true);
      const resp = await handleEthSubscribe(defaultParams);

      assertJsonRpcResult(resp);

      expect(resp.result).to.equal(subscriptionId);
    });

    for (const [name, value] of [
      ['ENABLE_TX_POOL', false],
      ['ENABLE_NONCE_ORDERING', false],
      ['DISABLE_MN_PRECHECKS_ON_TX_SENDING', true],
    ] as const) {
      it(`should not be able to subscribe to new pending transactions if ${name} is ${value}`, async function () {
        stubConfigService.withArgs('ENABLE_TX_POOL').returns(true);
        stubConfigService.withArgs('ENABLE_NONCE_ORDERING').returns(true);
        stubConfigService.withArgs(name).returns(value);

        await expect(
          handleEthSubscribe({ ...defaultParams, params: [constants.SUBSCRIBE_EVENTS.NEW_PENDING_TRANSACTIONS] }),
        ).to.be.eventually.rejected.and.have.property('code', -32601);
        sinon.assert.notCalled(stubSubscriptionService.subscribe);
      });
    }

    for (const [includeTransactions, filters] of [
      [undefined, { includeTransactions: false }],
      [false, { includeTransactions: false }],
      [true, { includeTransactions: true }],
    ]) {
      it(`should subscribe to new pending transactions with ${JSON.stringify(includeTransactions)}`, async function () {
        stubSubscriptionService.subscribe.returns(subscriptionId);
        stubConfigService.withArgs('ENABLE_TX_POOL').returns(true);
        stubConfigService.withArgs('ENABLE_NONCE_ORDERING').returns(true);
        const ctx = createMockContext();
        const resp = await handleEthSubscribe({
          ...defaultParams,
          ctx,
          params: [constants.SUBSCRIBE_EVENTS.NEW_PENDING_TRANSACTIONS, includeTransactions],
        });

        assertJsonRpcResult(resp);

        expect(resp.result).to.equal(subscriptionId);
        sinon.assert.calledOnceWithExactly(
          stubSubscriptionService.subscribe,
          ctx.websocket,
          constants.SUBSCRIBE_EVENTS.NEW_PENDING_TRANSACTIONS,
          filters,
        );
      });
    }

    it('should throw unsupported method for non-existing method', async function () {
      await expect(
        handleEthSubscribe({
          ...defaultParams,
          params: [nonExistingMethod, {}],
        }),
      ).to.be.eventually.rejected.and.have.property('code', -32601);
    });
  });
});
