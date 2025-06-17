// SPDX-License-Identifier: Apache-2.0

import { Relay } from '@hashgraph/json-rpc-relay';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { EthImpl } from '@hashgraph/json-rpc-relay/src/lib/eth';
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import { Counter, Histogram } from 'prom-client';
import sinon from 'sinon';

import ConnectionLimiter from '../../src/metrics/connectionLimiter';
import WsMetricRegistry from '../../src/metrics/wsMetricRegistry';
import { SubscriptionService } from '../../src/service/subscriptionService';
import {
  constructValidLogSubscriptionFilter,
  getBatchRequestsMaxSize,
  getMultipleAddressesEnabled,
  getWsBatchRequestsEnabled,
  handleConnectionClose,
  sendToClient,
} from '../../src/utils/utils';
import { WsTestHelper } from '../helper';

const registry = new Registry();
const logger = pino({ level: 'silent' });

describe('Utilities unit tests', async function () {
  describe('constructValidLogSubscriptionFilter tests', () => {
    it('Should ignore all the unexpected params and return a new filter object with valid params (address, topics)', () => {
      const originalFilter = {
        address: '0x23f5e49569A835d7bf9AefD30e4f60CdD570f225',
        topics: ['0x1d29d0f04057864b829c60f025fdba344f1623eb30b90820f5a6c39ffbd1c512'],
        fromBlock: '0x0',
        toBlock: 'latest',
        hedera: '0xhbar',
      };
      const originalFilterKeys = Object.keys(originalFilter);

      const validFilter = constructValidLogSubscriptionFilter(originalFilter);
      const validFilterKeys = Object.keys(validFilter);

      expect(validFilterKeys).to.not.deep.eq(originalFilterKeys);
      expect(validFilterKeys.length).to.eq(2); // address & topics
      expect(validFilter['address']).to.eq(originalFilter.address);
      expect(validFilter['topics']).to.eq(originalFilter.topics);
      expect(validFilter['fromBlock']).to.not.exist;
      expect(validFilter['toBlock']).to.not.exist;
      expect(validFilter['hedera']).to.not.exist;
    });

    it('Should only add valid params if presented in original filter object', () => {
      // original missing `address` param
      const originalFilter1 = {
        topics: ['0x1d29d0f04057864b829c60f025fdba344f1623eb30b90820f5a6c39ffbd1c512'],
      };
      const validFilter1 = constructValidLogSubscriptionFilter(originalFilter1);
      const validFilter1Keys = Object.keys(validFilter1);
      expect(validFilter1Keys.length).to.eq(1);
      expect(validFilter1['address']).to.not.exist;
      expect(validFilter1['topics']).to.eq(originalFilter1.topics);

      // original missing `topics` param
      const originalFilter2 = {
        address: '0x23f5e49569A835d7bf9AefD30e4f60CdD570f225',
      };
      const validFilter2 = constructValidLogSubscriptionFilter(originalFilter2);
      const validFilter2Keys = Object.keys(validFilter2);
      expect(validFilter2Keys.length).to.eq(1);
      expect(validFilter2['topics']).to.not.exist;
      expect(validFilter2['address']).to.eq(originalFilter2.address);
    });
  });

  describe('sendToClient', () => {
    let connectionMock: any;
    let loggerMock: any;
    let request: any;
    let response: any;
    const requestDetails = new RequestDetails({
      requestId: 'req-123',
      ipAddress: '0.0.0.0',
      connectionId: 'conn-456',
    });

    beforeEach(() => {
      connectionMock = {
        send: sinon.stub(),
        limiter: {
          resetInactivityTTLTimer: sinon.stub(),
        },
      };

      loggerMock = {
        trace: sinon.stub(),
      };

      request = { id: '1', method: 'testMethod' };
      response = { result: 'testResult' };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should log the response being sent to the client', () => {
      sendToClient(connectionMock, request, response, loggerMock, requestDetails);

      const expectedLogMessage = `${requestDetails.formattedLogPrefix}: Sending result=${JSON.stringify(
        response,
      )} to client for request=${JSON.stringify(request)}`;

      expect(loggerMock.trace.calledOnce).to.be.true;
      expect(loggerMock.trace.calledWith(expectedLogMessage)).to.be.true;
    });

    it('should send the response to the client connection', () => {
      sendToClient(connectionMock, request, response, loggerMock, requestDetails);

      expect(connectionMock.send.calledOnce).to.be.true;
      expect(connectionMock.send.calledWith(JSON.stringify(response))).to.be.true;
    });

    it('should reset the inactivity TTL timer for the client connection', () => {
      sendToClient(connectionMock, request, response, loggerMock, requestDetails);

      expect(connectionMock.limiter.resetInactivityTTLTimer.calledOnce).to.be.true;
      expect(connectionMock.limiter.resetInactivityTTLTimer.calledWith(connectionMock)).to.be.true;
    });
  });

  describe('handleConnectionClose', () => {
    let relayStub: sinon.SinonStubbedInstance<Relay>;
    let limiterStub: sinon.SinonStubbedInstance<ConnectionLimiter>;
    let wsMetricRegistryStub: sinon.SinonStubbedInstance<WsMetricRegistry>;
    let ctxStub: any;
    let startTime: [number, number];
    let subscriptionService: SubscriptionService | undefined;
    let unsubscribeSpy: sinon.SinonSpy;

    beforeEach(async () => {
      relayStub = sinon.createStubInstance(Relay);
      relayStub.eth.returns(sinon.createStubInstance(EthImpl));
      limiterStub = sinon.createStubInstance(ConnectionLimiter);
      wsMetricRegistryStub = sinon.createStubInstance(WsMetricRegistry);
      wsMetricRegistryStub.getCounter.returns(sinon.createStubInstance(Counter));
      wsMetricRegistryStub.getHistogram.returns(
        sinon.createStubInstance(Histogram, {
          labels: sinon.stub<[Partial<Record<any, string | number>>]>().returns({
            observe: sinon.spy(),
            startTimer: sinon.spy(),
          }),
        }),
      );
      ctxStub = {
        websocket: {
          id: 'mock-id',
          terminate: sinon.spy(),
        },
      };

      startTime = process.hrtime();

      subscriptionService = new SubscriptionService(relayStub, logger, registry);

      expect(subscriptionService).to.not.be.undefined;
      unsubscribeSpy = sinon.spy(subscriptionService, 'unsubscribe');

      await handleConnectionClose(ctxStub, subscriptionService, limiterStub, wsMetricRegistryStub, startTime);
    });

    it('should unsubscribe subscriptions', async () => {
      expect(unsubscribeSpy.calledOnceWith(ctxStub.websocket)).to.be.true;
    });

    it('should decrement the limiter counters', async () => {
      expect(limiterStub.decrementCounters.calledWith(ctxStub)).to.be.true;
    });

    it('should increment the total closed connections counter', async () => {
      const incStub = wsMetricRegistryStub.getCounter('totalClosedConnections').inc as sinon.SinonSpy;
      expect(incStub.calledOnce).to.be.true;
    });

    it('should update the connection duration histogram', async () => {
      const observeSpy = wsMetricRegistryStub.getHistogram('connectionDuration').observe as sinon.SinonSpy;
      expect(observeSpy.calledOnce).to.be.true;
    });

    it('should terminate the websocket connection', async () => {
      expect(ctxStub.websocket.terminate.calledOnce).to.be.true;
    });
  });

  describe('getMultipleAddressesEnabled', () => {
    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_MULTIPLE_ADDRESSES_ENABLED: true }, () => {
      it('should return true', () => {
        expect(getMultipleAddressesEnabled()).to.be.true;
      });
    });

    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_MULTIPLE_ADDRESSES_ENABLED: false }, () => {
      it('should return false', () => {
        expect(getMultipleAddressesEnabled()).to.be.false;
      });
    });

    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_MULTIPLE_ADDRESSES_ENABLED: undefined }, () => {
      it('should return false', () => {
        expect(getMultipleAddressesEnabled()).to.be.false;
      });
    });
  });

  describe('getWsBatchRequestsEnabled', () => {
    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_BATCH_REQUESTS_ENABLED: true }, () => {
      it('should return true', () => {
        expect(getWsBatchRequestsEnabled()).to.be.true;
      });
    });

    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_BATCH_REQUESTS_ENABLED: false }, () => {
      it('should return false', () => {
        expect(getWsBatchRequestsEnabled()).to.be.false;
      });
    });

    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_BATCH_REQUESTS_ENABLED: undefined }, () => {
      it('should return true', () => {
        expect(getWsBatchRequestsEnabled()).to.be.true;
      });
    });
  });

  describe('getBatchRequestsMaxSize', () => {
    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_BATCH_REQUESTS_MAX_SIZE: 50 }, () => {
      it('should return 50', () => {
        expect(getBatchRequestsMaxSize()).to.equal(50);
      });
    });

    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_BATCH_REQUESTS_MAX_SIZE: 0 }, () => {
      it('should return 0', () => {
        expect(getBatchRequestsMaxSize()).to.equal(0);
      });
    });

    WsTestHelper.withOverriddenEnvsInMochaTest({ WS_BATCH_REQUESTS_MAX_SIZE: undefined }, () => {
      it('should return 20', () => {
        expect(getBatchRequestsMaxSize()).to.equal(20);
      });
    });
  });
});
