// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { WebSocketError } from '@hashgraph/json-rpc-relay/dist';
import * as methodConfigModule from '@hashgraph/json-rpc-relay/dist/lib/config/methodConfiguration';
import { IPRateLimiterService } from '@hashgraph/json-rpc-relay/dist/lib/services';
import { expect } from 'chai';
import { time } from 'console';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import ConnectionLimiter from '../../src/metrics/connectionLimiter';
import { WS_CONSTANTS } from '../../src/utils/constants';

describe('Connection Limiter', function () {
  let connectionLimiter: ConnectionLimiter;
  let mockLogger: any;
  let mockRegistry: Registry;
  let configServiceStub: sinon.SinonStub;
  let rateLimiterStub: sinon.SinonStub;
  let methodConfigStub: sinon.SinonStub;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
      isLevelEnabled: sinon.stub().returns(true),
      child: sinon.stub().returnsThis(),
    };

    // Mock registry
    mockRegistry = new Registry();
    sinon.stub(mockRegistry, 'removeSingleMetric');

    // Mock ConfigService
    configServiceStub = sinon.stub(ConfigService, 'get');
    configServiceStub.withArgs('WS_CONNECTION_LIMIT').returns(100);
    configServiceStub.withArgs('WS_CONNECTION_LIMIT_PER_IP').returns(10);
    configServiceStub.withArgs('WS_MAX_INACTIVITY_TTL').returns(30000);
    configServiceStub.withArgs('WS_SUBSCRIPTION_LIMIT').returns(10);
    configServiceStub.withArgs('LIMIT_DURATION').returns(60000);
    configServiceStub.withArgs('IP_RATE_LIMIT_STORE').returns('LRU');

    const rateLimiter = new IPRateLimiterService(mockLogger, mockRegistry, 9000);
    // Mock methodConfiguration
    methodConfigStub = sinon.stub(methodConfigModule, 'methodConfiguration').value({
      eth_call: { total: 100 },
      eth_getBalance: { total: 50 },
      eth_getLogs: { total: 25 },
      eth_subscribe: { total: 10 },
      eth_unsubscribe: { total: 10 },
    });
    // Mock IPRateLimiterService
    rateLimiterStub = sinon.stub(IPRateLimiterService.prototype, 'shouldRateLimit');
    connectionLimiter = new ConnectionLimiter(mockLogger, mockRegistry, rateLimiter);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('applyLimits', function () {
    it('should close connection when total connection limit is exceeded', function () {
      // Arrange
      const mockWebsocket = {
        id: 'test-connection-id',
        send: sinon.stub(),
        close: sinon.stub(),
      };

      const mockContext = {
        websocket: mockWebsocket,
        request: { ip: '127.0.0.1' },
        app: {
          server: {
            _connections: 101, // Exceeds the limit of 100
          },
        },
      };

      // Set up the connection limiter state
      connectionLimiter['connectedClients'] = 101;

      // Act
      connectionLimiter.applyLimits(mockContext);

      // Assert
      sinon.assert.calledWith(
        mockLogger.info,
        'Closing connection test-connection-id due to exceeded maximum connections (max_con=100)',
      );

      sinon.assert.calledWith(
        mockWebsocket.send,
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
        mockWebsocket.close,
        WebSocketError.CONNECTION_LIMIT_EXCEEDED.code,
        WebSocketError.CONNECTION_LIMIT_EXCEEDED.message,
      );
    });

    it('should close connection when per-IP connection limit is exceeded', function () {
      // Arrange
      const mockWebsocket = {
        id: 'test-connection-id',
        send: sinon.stub(),
        close: sinon.stub(),
      };

      const mockContext = {
        websocket: mockWebsocket,
        request: { ip: '127.0.0.1' },
        app: {
          server: {
            _connections: 50, // Within total limit
          },
        },
      };

      // Set up the connection limiter state
      connectionLimiter['connectedClients'] = 50;
      connectionLimiter['clientIps']['127.0.0.1'] = 11; // Exceeds per-IP limit of 10

      // Act
      connectionLimiter.applyLimits(mockContext);

      // Assert
      sinon.assert.calledWith(
        mockLogger.info,
        'Closing connection test-connection-id due to exceeded maximum connections from a single IP: address 127.0.0.1 - 11 connections. (max_con=10)',
      );

      sinon.assert.calledWith(
        mockWebsocket.send,
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
        mockWebsocket.close,
        WebSocketError.CONNECTION_IP_LIMIT_EXCEEDED.code,
        WebSocketError.CONNECTION_IP_LIMIT_EXCEEDED.message,
      );
    });

    it('should start inactivity TTL timer when connection is within limits', function () {
      // Arrange
      const mockWebsocket = {
        id: 'test-connection-id',
        send: sinon.stub(),
        close: sinon.stub(),
      };

      const mockContext = {
        websocket: mockWebsocket,
        request: { ip: '127.0.0.1' },
        app: {
          server: {
            _connections: 50, // Within total limit
          },
        },
      };

      // Set up the connection limiter state
      connectionLimiter['connectedClients'] = 50;
      connectionLimiter['clientIps']['127.0.0.1'] = 5; // Within per-IP limit

      // Spy on the startInactivityTTLTimer method
      const startInactivityTTLTimerSpy = sinon.spy(connectionLimiter, 'startInactivityTTLTimer' as any);

      // Act
      connectionLimiter.applyLimits(mockContext);

      // Assert
      sinon.assert.calledWith(startInactivityTTLTimerSpy, mockWebsocket);
      sinon.assert.notCalled(mockWebsocket.send);
      sinon.assert.notCalled(mockWebsocket.close);
    });
  });

  describe('shouldRateLimitOnMethod', function () {
    it('should return false for eth_subscribe method', async function () {
      // Arrange
      const ip = '127.0.0.1';
      const methodName = WS_CONSTANTS.METHODS.ETH_SUBSCRIBE;
      const requestDetails = { requestId: 'test-request' };

      // Act
      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      // Assert
      expect(result).to.be.false;
      sinon.assert.notCalled(rateLimiterStub);
    });

    it('should return false for eth_unsubscribe method', async function () {
      // Arrange
      const ip = '127.0.0.1';
      const methodName = WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE;
      const requestDetails = { requestId: 'test-request' };

      // Act
      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      // Assert
      expect(result).to.be.false;
      sinon.assert.notCalled(rateLimiterStub);
    });

    it('should call shouldRateLimit for other methods', async function () {
      // Arrange
      const ip = '127.0.0.1';
      const methodName = 'eth_call';
      const requestDetails = { requestId: 'test-request' };
      const expectedLimit = 100;

      rateLimiterStub.resolves(false);

      // Act
      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      // Assert
      expect(result).to.be.false;
      sinon.assert.calledOnceWithExactly(rateLimiterStub, ip, methodName, expectedLimit, requestDetails);
    });

    it('should return true when rate limit is exceeded', async function () {
      // Arrange
      const ip = '127.0.0.1';
      const methodName = 'eth_getBalance';
      const requestDetails = { requestId: 'test-request' };
      const expectedLimit = 50;

      rateLimiterStub.resolves(true);

      // Act
      const result = await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      // Assert
      expect(result).to.be.true;
      sinon.assert.calledOnceWithExactly(rateLimiterStub, ip, methodName, expectedLimit, requestDetails);
    });

    it('should use correct method limit from methodConfiguration', async function () {
      // Arrange
      const ip = '127.0.0.1';
      const methodName = 'eth_getLogs';
      const requestDetails = { requestId: 'test-request' };
      const expectedLimit = 25;

      rateLimiterStub.resolves(false);

      // Act
      await connectionLimiter.shouldRateLimitOnMethod(ip, methodName, requestDetails);

      // Assert
      sinon.assert.calledOnceWithExactly(rateLimiterStub, ip, methodName, expectedLimit, requestDetails);
    });

    it('should handle methods not in methodConfiguration', async function () {
      // Arrange
      const ip = '127.0.0.1';
      const methodName = 'unknown_method';
      const requestDetails = { requestId: 'test-request' };

      rateLimiterStub.resolves(false);

      // Act & Assert - This should throw an error when trying to access methodConfiguration[methodName].total
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
      const mockWebsocket = {
        id: 'test-connection-id',
        send: sinon.stub(),
        close: sinon.stub(),
      };

      const mockContext = {
        websocket: mockWebsocket,
        request: { ip: '127.0.0.1' },
        app: {
          server: {
            _connections: 10,
          },
        },
      };

      connectionLimiter['clientIps'] = { '127.0.0.1': 2 };

      connectionLimiter.incrementCounters(mockContext);

      expect(connectionLimiter['clientIps']['127.0.0.1']).to.eq(3);
    });

    it('should set ip counter for new ip', function () {
      const mockWebsocket = {
        id: 'test-connection-id',
        send: sinon.stub(),
        close: sinon.stub(),
      };

      const mockContext = {
        websocket: mockWebsocket,
        request: { ip: '127.0.0.2' },
        app: {
          server: {
            _connections: 10,
          },
        },
      };

      connectionLimiter['clientIps'] = { '127.0.0.1': 2 };

      connectionLimiter.incrementCounters(mockContext);

      expect(connectionLimiter['clientIps']['127.0.0.2']).to.eq(1);
      expect(connectionLimiter['clientIps']['127.0.0.1']).to.eq(2);
    });
  });

  describe('decrementCounts', function () {
    it('should decrement ip counter for existing ip', function () {
      const mockWebsocket = {
        id: 'test-connection-id',
        send: sinon.stub(),
        close: sinon.stub(),
        ipCounted: true,
      };

      const mockContext = {
        websocket: mockWebsocket,
        request: { ip: '127.0.0.1' },
      };

      connectionLimiter['connectedClients'] = 10;
      connectionLimiter['clientIps'] = { '127.0.0.1': 2 };

      connectionLimiter.decrementCounters(mockContext);

      expect(connectionLimiter['clientIps']['127.0.0.1']).to.eq(1);
      expect(connectionLimiter['connectedClients']).to.eq(9);
    });

    it('should set ip counter for new ip', function () {
      const mockWebsocket = {
        id: 'test-connection-id',
        send: sinon.stub(),
        close: sinon.stub(),
        ipCounted: true,
      };

      const mockContext = {
        websocket: mockWebsocket,
        request: { ip: '127.0.0.1' },
        app: {
          server: {
            _connections: 10,
          },
        },
      };

      connectionLimiter['clientIps'] = { '127.0.0.1': 1 };

      connectionLimiter.decrementCounters(mockContext);

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
      const mockWebsocket = {
        id: 'test-connection-id',
        subscriptions: 0,
      };

      const mockContext = {
        websocket: mockWebsocket,
      };

      connectionLimiter.incrementSubs(mockContext);

      expect(mockContext.websocket.subscriptions).to.eq(1);
    });
  });

  describe('decrementSubs', function () {
    it('should decrement subscription count by 1 by default', function () {
      // Arrange
      const mockWebsocket = {
        id: 'test-connection-id',
        subscriptions: 5,
      };

      const mockContext = {
        websocket: mockWebsocket,
      };

      connectionLimiter.decrementSubs(mockContext);

      expect(mockContext.websocket.subscriptions).to.eq(4);
    });

    it('should decrement subscription count by specified amount', function () {
      // Arrange
      const mockWebsocket = {
        id: 'test-connection-id',
        subscriptions: 10,
      };

      const mockContext = {
        websocket: mockWebsocket,
      };

      connectionLimiter.decrementSubs(mockContext, 3);

      expect(mockContext.websocket.subscriptions).to.eq(7);
    });

    it('should decrement subscription count to 0', function () {
      // Arrange
      const mockWebsocket = {
        id: 'test-connection-id',
        subscriptions: 1,
      };

      const mockContext = {
        websocket: mockWebsocket,
      };

      connectionLimiter.decrementSubs(mockContext);

      expect(mockContext.websocket.subscriptions).to.eq(0);
    });
  });
});
