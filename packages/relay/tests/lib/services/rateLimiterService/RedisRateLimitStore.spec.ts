// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import { Logger, pino } from 'pino';
import { Counter, Registry } from 'prom-client';
import { RedisClientType } from 'redis';
import * as redis from 'redis';
import * as sinon from 'sinon';

import { RedisCacheError } from '../../../../src/lib/errors/RedisCacheError';
import * as RedisCacheErrorModule from '../../../../src/lib/errors/RedisCacheError';
import { RedisRateLimitStore } from '../../../../src/lib/services/rateLimiterService/RedisRateLimitStore';
import { RateLimitKey } from '../../../../src/lib/types/rateLimiter';
import { RequestDetails } from '../../../../src/lib/types/RequestDetails';

describe('RedisRateLimitStore Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let registry: Registry;
  let mockRedisClient: sinon.SinonStubbedInstance<RedisClientType>;
  let createClientStub: sinon.SinonStub;
  let configServiceStub: sinon.SinonStub;
  let rateLimitStoreFailureCounter: Counter;

  const testDuration = 5000;
  const testKey = new RateLimitKey('127.0.0.1', 'eth_chainId');
  const testLimit = 5;
  const requestDetails = new RequestDetails({ requestId: 'test-request-id', ipAddress: '127.0.0.1' });

  beforeEach(() => {
    logger = pino({ level: 'silent' });
    registry = new Registry();
    rateLimitStoreFailureCounter = new Counter({
      name: 'test_rate_limit_store_failure',
      help: 'Test counter for rate limit store failures',
      labelNames: ['store_type', 'method'],
      registers: [registry],
    });

    // Create a mock Redis client
    mockRedisClient = {
      connect: sinon.stub(),
      on: sinon.stub(),
      eval: sinon.stub(),
      quit: sinon.stub(),
    } as any;

    // Stub the createClient function
    createClientStub = sinon.stub().returns(mockRedisClient);
    sinon.replace(redis, 'createClient', createClientStub);

    // Stub ConfigService
    configServiceStub = sinon.stub(ConfigService, 'get');
    configServiceStub.withArgs('REDIS_URL').returns('redis://localhost:6379');
    configServiceStub.withArgs('REDIS_RECONNECT_DELAY_MS').returns(1000);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Constructor Tests', () => {
    it('should create RedisRateLimitStore and set up event listeners', () => {
      mockRedisClient.connect.resolves();

      new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      expect(createClientStub.calledOnce).to.be.true;
      expect(mockRedisClient.on.calledWith('ready')).to.be.true;
      expect(mockRedisClient.on.calledWith('end')).to.be.true;
      expect(mockRedisClient.on.calledWith('error')).to.be.true;
    });

    it('should create RedisRateLimitStore with successful connection', async () => {
      mockRedisClient.connect.resolves();

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      expect(createClientStub.calledOnce).to.be.true;
      expect(mockRedisClient.connect.calledOnce).to.be.true;
      expect(await store.isConnected()).to.be.true;
    });

    it('should handle connection failure during initialization', async () => {
      const connectionError = new Error('Redis connection failed');
      mockRedisClient.connect.rejects(connectionError);

      const testLogger = pino({ level: 'error' });

      const store = new RedisRateLimitStore(testLogger, testDuration, rateLimitStoreFailureCounter);

      const loggerErrorSpy = sinon.spy(store['logger'], 'error');

      const isConnected = await store.isConnected();

      expect(isConnected).to.be.false;
      expect(loggerErrorSpy.calledOnce).to.be.true;
      expect(loggerErrorSpy.getCall(0).args[0]).to.equal(connectionError);
      expect(loggerErrorSpy.getCall(0).args[1]).to.equal('Rate limiter Redis connection could not be established!');
    });

    it('should handle reconnection strategy', () => {
      mockRedisClient.connect.resolves();

      const testLogger = pino({ level: 'warn' });

      const store = new RedisRateLimitStore(testLogger, testDuration, rateLimitStoreFailureCounter);

      const loggerWarnSpy = sinon.spy(store['logger'], 'warn');

      const createClientCall = createClientStub.getCall(0);
      const config = createClientCall.args[0];

      expect(config.socket.reconnectStrategy).to.be.a('function');

      // Test reconnection strategy
      const reconnectDelay = config.socket.reconnectStrategy(3);
      expect(reconnectDelay).to.equal(3000); // 3 retries * 1000ms delay
      expect(loggerWarnSpy.calledOnce).to.be.true;
      expect(loggerWarnSpy.calledWith('Rate limiter Redis reconnection attempt #3. Delay: 3000ms')).to.be.true;
    });

    it('should handle Redis ready event', async () => {
      mockRedisClient.connect.resolves();

      const testLogger = pino({ level: 'info' });

      const store = new RedisRateLimitStore(testLogger, testDuration, rateLimitStoreFailureCounter);

      const loggerInfoSpy = sinon.spy(store['logger'], 'info');

      // Simulate ready event
      const readyHandler = mockRedisClient.on.getCalls().find((call) => call.args[0] === 'ready')?.args[1];
      readyHandler?.();

      expect(await store.isConnected()).to.be.true;
      expect(loggerInfoSpy.calledOnce).to.be.true;
      expect(loggerInfoSpy.calledWith('Rate limiter connected to Redis server successfully!')).to.be.true;
    });

    it('should handle Redis end event', async () => {
      mockRedisClient.connect.resolves();

      const testLogger = pino({ level: 'info' });

      const store = new RedisRateLimitStore(testLogger, testDuration, rateLimitStoreFailureCounter);

      const loggerInfoSpy = sinon.spy(store['logger'], 'info');

      // Simulate end event
      const endHandler = mockRedisClient.on.getCalls().find((call) => call.args[0] === 'end')?.args[1];
      endHandler?.();

      expect(await store.isConnected()).to.be.false;
      expect(loggerInfoSpy.calledOnce).to.be.true;
      expect(loggerInfoSpy.calledWith('Rate limiter disconnected from Redis server!')).to.be.true;
    });

    it('should handle Redis error event with socket closed error', async () => {
      mockRedisClient.connect.resolves();

      const testLogger = pino({ level: 'error' });

      const store = new RedisRateLimitStore(testLogger, testDuration, rateLimitStoreFailureCounter);

      const loggerErrorSpy = sinon.spy(store['logger'], 'error');

      // Create a mock error that would be considered socket closed
      const socketError = new Error('Socket closed');
      const redisCacheError = new RedisCacheError(socketError);
      sinon.stub(redisCacheError, 'isSocketClosed').returns(true);

      // Simulate error event
      const errorHandler = mockRedisClient.on.getCalls().find((call) => call.args[0] === 'error')?.args[1];
      errorHandler?.(redisCacheError);

      expect(await store.isConnected()).to.be.false;
      expect(loggerErrorSpy.calledOnce).to.be.true;
      const logCall = loggerErrorSpy.getCall(0);
      expect(logCall.args[0]).to.equal('Rate limiter Redis error: RedisCacheError: Socket closed');
    });

    it('should handle Redis error event with non-socket error', async () => {
      mockRedisClient.connect.resolves();

      const testLogger = pino({ level: 'error' });

      // Mock RedisCacheError to return false for isSocketClosed
      const mockRedisCacheError = {
        isSocketClosed: sinon.stub().returns(false),
        fullError: 'Full Redis error message',
      };
      const redisCacheErrorStub = sinon.stub(RedisCacheErrorModule, 'RedisCacheError').returns(mockRedisCacheError);

      const store = new RedisRateLimitStore(testLogger, testDuration, rateLimitStoreFailureCounter);

      const loggerErrorSpy = sinon.spy(store['logger'], 'error');

      // Simulate error event
      const errorHandler = mockRedisClient.on.getCalls().find((call) => call.args[0] === 'error')?.args[1];
      errorHandler?.(new Error('Redis error'));

      expect(await store.isConnected()).to.be.false;
      expect(loggerErrorSpy.calledOnce).to.be.true;
      expect(loggerErrorSpy.getCall(0).args[0]).to.equal('Rate limiter Redis error: Full Redis error message');

      redisCacheErrorStub.restore();
    });
  });

  describe('getConnectedClient Tests', () => {
    it('should fail open when Redis client is not connected', async () => {
      mockRedisClient.connect.rejects(new Error('Connection failed'));

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      // Wait for connection promise to resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should fail open (return false) when Redis is not connected
      const result = await store.incrementAndCheck(testKey, testLimit, requestDetails);
      expect(result).to.be.false;
    });
  });

  describe('incrementAndCheck Tests', () => {
    it('should successfully increment and check rate limit', async () => {
      mockRedisClient.connect.resolves();
      mockRedisClient.eval.resolves(0); // Not rate limited

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      const result = await store.incrementAndCheck(testKey, testLimit, requestDetails);

      expect(result).to.be.false;
      expect(mockRedisClient.eval.calledOnce).to.be.true;

      const evalCall = mockRedisClient.eval.getCall(0);
      const evalOptions = evalCall.args[1] as { keys: string[]; arguments: string[] };
      expect(evalOptions.keys).to.deep.equal([testKey.toString()]);
      expect(evalOptions.arguments).to.deep.equal([String(testLimit), String(Math.ceil(testDuration / 1000))]);
    });

    it('should return true when rate limit is exceeded', async () => {
      mockRedisClient.connect.resolves();
      mockRedisClient.eval.resolves(1); // Rate limited

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      const result = await store.incrementAndCheck(testKey, testLimit, requestDetails);

      expect(result).to.be.true;
    });

    it('should handle Redis operation failure and fail open', async () => {
      mockRedisClient.connect.resolves();
      const redisError = new Error('Redis operation failed');
      mockRedisClient.eval.rejects(redisError);

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      const result = await store.incrementAndCheck(testKey, testLimit, requestDetails);

      expect(result).to.be.false; // Fail open
    });

    it('should increment failure counter when Redis operation fails', async () => {
      mockRedisClient.connect.resolves();
      const redisError = new Error('Redis operation failed');
      mockRedisClient.eval.rejects(redisError);

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      const counterSpy = sinon.spy(rateLimitStoreFailureCounter, 'inc');

      await store.incrementAndCheck(testKey, testLimit, requestDetails);

      expect(counterSpy.calledOnce).to.be.true;
    });

    it('should handle Redis operation failure without failure counter', async () => {
      mockRedisClient.connect.resolves();
      const redisError = new Error('Redis operation failed');
      mockRedisClient.eval.rejects(redisError);

      const store = new RedisRateLimitStore(logger, testDuration); // No failure counter

      const result = await store.incrementAndCheck(testKey, testLimit, requestDetails);

      expect(result).to.be.false; // Should still fail open
    });

    it('should handle non-Error object in catch block', async () => {
      mockRedisClient.connect.resolves();
      const stringError = 'String error';
      mockRedisClient.eval.rejects(stringError);

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      const result = await store.incrementAndCheck(testKey, testLimit, requestDetails);

      expect(result).to.be.false; // Should still fail open
    });
  });

  describe('isConnected Tests', () => {
    it('should return true when connected', async () => {
      mockRedisClient.connect.resolves();

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      expect(await store.isConnected()).to.be.true;
    });

    it('should return false when not connected', async () => {
      mockRedisClient.connect.rejects(new Error('Connection failed'));

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      // Wait for connection promise to resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await store.isConnected()).to.be.false;
    });
  });

  describe('disconnect Tests', () => {
    it('should disconnect successfully when connected', async () => {
      mockRedisClient.connect.resolves();
      mockRedisClient.quit.resolves();

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      await store.disconnect();

      expect(mockRedisClient.quit.calledOnce).to.be.true;
    });

    it('should handle disconnect error gracefully', async () => {
      mockRedisClient.connect.resolves();
      const disconnectError = new Error('Disconnect failed');
      mockRedisClient.quit.rejects(disconnectError);

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      // Should not throw error even if disconnect fails
      await store.disconnect();

      expect(mockRedisClient.quit.calledOnce).to.be.true;
    });

    it('should not call quit when not connected', async () => {
      mockRedisClient.connect.rejects(new Error('Connection failed'));

      const store = new RedisRateLimitStore(logger, testDuration, rateLimitStoreFailureCounter);

      // Wait for connection promise to resolve
      await new Promise((resolve) => setTimeout(resolve, 100));

      await store.disconnect();

      expect(mockRedisClient.quit.notCalled).to.be.true;
    });
  });
});
