// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { WebSocketError } from '@hashgraph/json-rpc-relay/dist';
import * as methodConfigModule from '@hashgraph/json-rpc-relay/dist/lib/config/methodConfiguration';
import { IPRateLimiterService } from '@hashgraph/json-rpc-relay/dist/lib/services';
import { expect } from 'chai';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import ConnectionLimiter from '../../src/metrics/connectionLimiter';
import { WS_CONSTANTS } from '../../src/utils/constants';

function createMockContext({
  connections = 0,
  ip = '127.0.0.1',
  ipCounted = false,
  subscriptions = 0,
}: {
  connections?: number;
  ip?: string;
  ipCounted?: boolean;
  subscriptions?: number;
} = {}): MockContext {
  const websocket: MockWebsocket = {
    id: 'test-connection-id',
    send: sinon.stub(),
    close: sinon.stub(),
    inactivityTTL: undefined,
    ipCounted,
    subscriptions,
  };
  return {
    websocket,
    request: { ip },
    app: { server: { _connections: connections } },
  };
}

describe('Connection Limiter', function () {
  let configServiceStub: sinon.SinonStub;
  let connectionLimiter: ConnectionLimiter;
  let mockLogger: any;
  let mockRegistry: Registry;
  let rateLimiterStub: sinon.SinonStub;

  beforeEach(() => {
    mockLogger = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
      isLevelEnabled: sinon.stub().returns(true),
      child: sinon.stub().returnsThis(),
    };

    mockRegistry = new Registry();
    sinon.stub(mockRegistry, 'removeSingleMetric');

    configServiceStub = sinon.stub(ConfigService, 'get');
    configServiceStub.withArgs('WS_CONNECTION_LIMIT').returns(100);
    configServiceStub.withArgs('WS_CONNECTION_LIMIT_PER_IP').returns(10);
    configServiceStub.withArgs('WS_MAX_INACTIVITY_TTL').returns(30000);
    configServiceStub.withArgs('WS_SUBSCRIPTION_LIMIT').returns(10);
    configServiceStub.withArgs('LIMIT_DURATION').returns(60000);
    configServiceStub.withArgs('IP_RATE_LIMIT_STORE').returns('LRU');

    const rateLimiter = new IPRateLimiterService(mockLogger, mockRegistry, 9000);

    rateLimiterStub = sinon.stub(IPRateLimiterService.prototype, 'shouldRateLimit');
    connectionLimiter = new ConnectionLimiter(mockLogger, mockRegistry, rateLimiter);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('applyLimits', function () {
    it('should close connection when total connection limit is exceeded', function () {
      const ctx = createMockContext({ connections: 101 });

      connectionLimiter['connectedClients'] = 101;
      connectionLimiter.applyLimits(ctx);

      sinon.assert.calledWith(
        mockLogger.info,
        'Closing connection test-connection-id due to exceeded maximum connections (max_con=100)',
      );

      sinon.assert.calledWith(
        ctx.websocket.send,
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: WebSocketError.CONNECTION_LIMIT_EXCEEDED.code,
            message: WebSocketError.CONNECTION_LIMIT_EXCEEDED.message,
            data: {
              message: WebSocketError.CONNECTION_LIMIT_EXCEEDED.message,
              max_connection: 100,
            },
          },
          id: '1',
        }),
      );

      sinon.assert.calledWith(
        ctx.websocket.close,
        WebSocketError.CONNECTION_LIMIT_EXCEEDED.code,
        WebSocketError.CONNECTION_LIMIT_EXCEEDED.message,
      );
    });

    it('should close connection when per-IP connection limit is exceeded', function () {
      const ctx = createMockContext({ connections: 50, ip: '127.0.0.1' });

      connectionLimiter['connectedClients'] = 50;
      connectionLimiter['clientIps']['127.0.0.1'] = 11; // Exceeds per-IP limit of 10

      connectionLimiter.applyLimits(ctx);

      sinon.assert.calledWith(
        mockLogger.info,
        'Closing connection test-connection-id due to exceeded maximum connections from a single IP: address 127.0.0.1 - 11 connections. (max_con=10)',
      );

      sinon.assert.calledWith(
        ctx.websocket.send,
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: WebSocketError.CONNECTION_IP_LIMIT_EXCEEDED.code,
            message: WebSocketError.CONNECTION_IP_LIMIT_EXCEEDED.message,
            data: {
              message: WebSocketError.CONNECTION_IP_LIMIT_EXCEEDED.message,
              max_connection: 10,
            },
          },
          id: '1',
        }),
      );

      sinon.assert.calledWith(
        ctx.websocket.close,
        WebSocketError.CONNECTION_IP_LIMIT_EXCEEDED.code,
        WebSocketError.CONNECTION_IP_LIMIT_EXCEEDED.message,
      );
    });

    it('should start inactivity TTL timer when connection is within limits', function () {
      const ctx = createMockContext({ connections: 50, ip: '127.0.0.1' });

      connectionLimiter['connectedClients'] = 50;
      connectionLimiter['clientIps']['127.0.0.1'] = 5; // Within per-IP limit

      const startInactivityTTLTimerSpy = sinon.spy(connectionLimiter, 'startInactivityTTLTimer' as any);

      connectionLimiter.applyLimits(ctx);

      sinon.assert.calledWith(startInactivityTTLTimerSpy, ctx.websocket);
      sinon.assert.notCalled(ctx.websocket.send);
      sinon.assert.notCalled(ctx.websocket.close);
    });
  });

  describe('shouldRateLimitOnMethod', function () {
    it('should return false for eth_subscribe method', async function () {
      const ip = '127.0.0.1';
      const methodName = WS_CONSTANTS.METHODS.ETH_SUBSCRIBE;
      const requestDetails = { requestId: 'test-request' };

      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      expect(result).to.be.false;
      sinon.assert.notCalled(rateLimiterStub);
    });

    it('should return false for eth_unsubscribe method', async function () {
      const ip = '127.0.0.1';
      const methodName = WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE;
      const requestDetails = { requestId: 'test-request' };

      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      expect(result).to.be.false;
      sinon.assert.notCalled(rateLimiterStub);
    });

    it('should call shouldRateLimit for other methods', async function () {
      const ip = '127.0.0.1';
      const methodName = 'eth_call';
      const requestDetails = { requestId: 'test-request' };
      const expectedLimit = 100;

      rateLimiterStub.resolves(false);

      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      expect(result).to.be.false;
      sinon.assert.calledOnceWithExactly(rateLimiterStub, ip, methodName, expectedLimit, requestDetails);
    });

    it('should return true when rate limit is exceeded', async function () {
      const ip = '127.0.0.1';
      const methodName = 'eth_getBalance';
      const requestDetails = { requestId: 'test-request' };
      const expectedLimit = 50;
      methodConfigModule.methodConfiguration = {
        eth_getBalance: { total: 50 },
      };

      rateLimiterStub.resolves(true);

      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      expect(result).to.be.true;
      sinon.assert.calledOnceWithExactly(rateLimiterStub, ip, methodName, expectedLimit, requestDetails);
    });

    it('should use correct method limit from methodConfiguration', async function () {
      const ip = '127.0.0.1';
      const methodName = 'eth_getLogs';
      const requestDetails = { requestId: 'test-request' };
      const expectedLimit = 25;
      methodConfigModule.methodConfiguration = {
        eth_getLogs: { total: 25 },
      };

      rateLimiterStub.resolves(false);

      await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      sinon.assert.calledOnceWithExactly(rateLimiterStub, ip, methodName, expectedLimit, requestDetails);
    });

    it('should handle methods not in methodConfiguration', async function () {
      const ip = '127.0.0.1';
      const methodName = 'unknown_method';
      const requestDetails = { requestId: 'test-request' };

      rateLimiterStub.resolves(false);

      try {
        await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);
        expect.fail('Should have thrown an error for unknown method');
      } catch (error) {
        expect(error).to.be.an('error');
      }
    });
  });

  describe('resetInactivityTTLTimer', function () {
    it('should clear timeout', function () {
      const timeoutId = setTimeout(() => {}, 3000);
      const mockWebsocket = {
        id: 'test-connection-id',
        inactivityTTL: timeoutId,
      };

      const clearTimeoutSpy = sinon.spy(global, 'clearTimeout');
      const startInactivityTTLTimerSpy = sinon.spy(connectionLimiter, 'startInactivityTTLTimer');
      connectionLimiter.resetInactivityTTLTimer(mockWebsocket);

      sinon.assert.calledOnce(clearTimeoutSpy);
      sinon.assert.calledWith(clearTimeoutSpy, timeoutId);
      sinon.assert.calledOnce(startInactivityTTLTimerSpy);

      clearTimeoutSpy.restore();
      startInactivityTTLTimerSpy.restore();
    });
  });

  describe('incrementCounters', function () {
    it('should increment ip counter for existing ip', function () {
      const ctx = createMockContext({ connections: 10, ip: '127.0.0.1' });

      connectionLimiter['clientIps'] = { '127.0.0.1': 2 };

      connectionLimiter.incrementCounters(ctx);

      expect(connectionLimiter['clientIps']['127.0.0.1']).to.eq(3);
    });

    it('should set ip counter for new ip', function () {
      const ctx = createMockContext({ connections: 10, ip: '127.0.0.2' });

      connectionLimiter['clientIps'] = { '127.0.0.1': 2 };

      connectionLimiter.incrementCounters(ctx);

      expect(connectionLimiter['clientIps']['127.0.0.2']).to.eq(1);
      expect(connectionLimiter['clientIps']['127.0.0.1']).to.eq(2);
    });
  });

  describe('decrementCounts', function () {
    it('should decrement ip counter for existing ip', function () {
      const ctx = createMockContext({ connections: 10, ip: '127.0.0.1', ipCounted: true });

      connectionLimiter['connectedClients'] = 10;
      connectionLimiter['clientIps'] = { '127.0.0.1': 2 };

      connectionLimiter.decrementCounters(ctx);

      expect(connectionLimiter['clientIps']['127.0.0.1']).to.eq(1);
      expect(connectionLimiter['connectedClients']).to.eq(9);
    });

    it('should set ip counter for new ip', function () {
      const ctx = createMockContext({ connections: 10, ip: '127.0.0.1', ipCounted: true });

      connectionLimiter['clientIps'] = { '127.0.0.1': 1 };

      connectionLimiter.decrementCounters(ctx);

      expect(connectionLimiter['clientIps']['127.0.0.1']).to.eq(undefined);
    });
  });

  describe('incrementSubs', function () {
    it('should increment subscription count', function () {
      const mockWebsocket = {
        id: 'test-connection-id',
        subscriptions: 5,
      };

      const mockContext = {
        websocket: mockWebsocket,
      };

      connectionLimiter.incrementSubs(mockContext);

      expect(mockContext.websocket.subscriptions).to.eq(6);
    });

    it('should increment subscription count from 0', function () {
      const ctx = createMockContext({ subscriptions: 0 });

      connectionLimiter.incrementSubs(ctx);

      expect(ctx.websocket.subscriptions).to.eq(1);
    });
  });

  describe('decrementSubs', function () {
    it('should decrement subscription count by 1 by default', function () {
      const ctx = createMockContext({ subscriptions: 5 });

      connectionLimiter.decrementSubs(ctx);

      expect(ctx.websocket.subscriptions).to.eq(4);
    });

    it('should decrement subscription count by specified amount', function () {
      const ctx = createMockContext({ subscriptions: 10 });

      connectionLimiter.decrementSubs(ctx, 3);

      expect(ctx.websocket.subscriptions).to.eq(7);
    });

    it('should decrement subscription count to 0', function () {
      const ctx = createMockContext({ subscriptions: 1 });

      connectionLimiter.decrementSubs(ctx);

      expect(ctx.websocket.subscriptions).to.eq(0);
    });
  });
});
