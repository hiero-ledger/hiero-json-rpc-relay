// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomUUID } from 'crypto';
import pino from 'pino';
import * as redisModule from 'redis';
import sinon from 'sinon';

import { LocalLockStrategy } from '../../../../src/lib/services/lockService/LocalLockStrategy';
import { LockService } from '../../../../src/lib/services/lockService/LockService';
import { RedisLockStrategy } from '../../../../src/lib/services/lockService/RedisLockStrategy';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

chai.use(chaiAsPromised);

describe('LockService Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const lockId = '0x123abc';
  const sessionKey = randomUUID();

  let lockService: LockService;
  let mockLocalLockStrategy: sinon.SinonStubbedInstance<LocalLockStrategy>;
  let mockRedisLockStrategy: sinon.SinonStubbedInstance<RedisLockStrategy>;

  afterEach(() => {
    sinon.restore();
  });

  // Helper functions to reduce repetition
  const createMockLocalStrategy = (): sinon.SinonStubbedInstance<LocalLockStrategy> => {
    return {
      acquireLock: sinon.stub().resolves(sessionKey),
      releaseLock: sinon.stub().resolves(),
    } as any;
  };

  const createMockRedisStrategy = (isConnected: boolean = true): sinon.SinonStubbedInstance<RedisLockStrategy> => {
    return {
      acquireLock: sinon.stub().resolves(sessionKey),
      releaseLock: sinon.stub().resolves(),
      isConnected,
    } as any;
  };

  const stubLocalLockStrategyConstructor = (mockStrategy: sinon.SinonStubbedInstance<LocalLockStrategy>) => {
    sinon.stub(LocalLockStrategy.prototype, 'acquireLock').callsFake(mockStrategy.acquireLock);
    sinon.stub(LocalLockStrategy.prototype, 'releaseLock').callsFake(mockStrategy.releaseLock);
  };

  const stubRedisLockStrategyConstructor = (mockStrategy: sinon.SinonStubbedInstance<RedisLockStrategy>) => {
    sinon.stub(RedisLockStrategy.prototype, 'acquireLock').callsFake(mockStrategy.acquireLock);
    sinon.stub(RedisLockStrategy.prototype, 'releaseLock').callsFake(mockStrategy.releaseLock);
    Object.defineProperty(RedisLockStrategy.prototype, 'isConnected', {
      get: sinon.stub().returns(mockStrategy.isConnected),
      configurable: true,
    });
  };

  describe('initialization and strategy selection', () => {
    describe('when Redis is disabled', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: false,
        REDIS_URL: '',
      });

      it('should initialize with LocalLockStrategy', () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        expect(lockService).to.exist;
      });

      it('should use LocalLockStrategy for lock operations', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        const result = await lockService.acquireLock(lockId);

        expect(result).to.equal(sessionKey);
        expect(mockLocalLockStrategy.acquireLock.calledWith(lockId)).to.be.true;
      });
    });

    describe('when Redis is enabled but URL is missing', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: true,
        REDIS_URL: '',
      });

      it('should fallback to LocalLockStrategy', () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        expect(lockService).to.exist;
      });

      it('should use LocalLockStrategy for lock operations', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        const result = await lockService.acquireLock(lockId);

        expect(result).to.equal(sessionKey);
        expect(mockLocalLockStrategy.acquireLock.calledWith(lockId)).to.be.true;
      });
    });

    describe('when Redis is enabled and URL is provided', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: true,
        REDIS_URL: 'redis://localhost:6379',
      });

      beforeEach(() => {
        // Mock Redis client to prevent actual connection
        const mockRedisClient = {
          connect: sinon.stub().resolves(),
          on: sinon.stub(),
        };
        sinon.stub(redisModule, 'createClient').returns(mockRedisClient as any);
      });

      it('should initialize with RedisLockStrategy', () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        expect(lockService).to.exist;
      });

      it('should use RedisLockStrategy for lock operations', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        const result = await lockService.acquireLock(lockId);

        expect(result).to.equal(sessionKey);
        expect(mockRedisLockStrategy.acquireLock.calledWith(lockId)).to.be.true;
      });
    });
  });

  describe('acquireLock', () => {
    describe('with LocalLockStrategy', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: false,
        REDIS_URL: '',
      });

      it('should successfully acquire lock', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        const result = await lockService.acquireLock(lockId);

        expect(result).to.equal(sessionKey);
        expect(mockLocalLockStrategy.acquireLock.calledOnce).to.be.true;
        expect(mockLocalLockStrategy.acquireLock.calledWith(lockId)).to.be.true;
      });

      it('should return null when strategy fails to acquire lock', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        mockLocalLockStrategy.acquireLock.resolves(null);
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        const result = await lockService.acquireLock(lockId);

        expect(result).to.be.null;
        expect(mockLocalLockStrategy.acquireLock.calledWith(lockId)).to.be.true;
      });

      it('should handle errors from strategy gracefully', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        mockLocalLockStrategy.acquireLock.rejects(new Error('Lock acquisition failed'));
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        await expect(lockService.acquireLock(lockId)).to.be.rejectedWith('Lock acquisition failed');
      });

      it('should handle multiple concurrent acquisitions', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        const sessionKey1 = randomUUID();
        const sessionKey2 = randomUUID();
        mockLocalLockStrategy.acquireLock.onFirstCall().resolves(sessionKey1);
        mockLocalLockStrategy.acquireLock.onSecondCall().resolves(sessionKey2);
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        const [result1, result2] = await Promise.all([lockService.acquireLock('0x1'), lockService.acquireLock('0x2')]);

        expect(result1).to.equal(sessionKey1);
        expect(result2).to.equal(sessionKey2);
        expect(mockLocalLockStrategy.acquireLock.callCount).to.equal(2);
      });
    });

    describe('with RedisLockStrategy', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: true,
        REDIS_URL: 'redis://localhost:6379',
      });

      beforeEach(() => {
        // Mock Redis client to prevent actual connection
        const mockRedisClient = {
          connect: sinon.stub().resolves(),
          on: sinon.stub(),
        };
        sinon.stub(redisModule, 'createClient').returns(mockRedisClient as any);
      });

      it('should successfully acquire lock', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        const result = await lockService.acquireLock(lockId);

        expect(result).to.equal(sessionKey);
        expect(mockRedisLockStrategy.acquireLock.calledOnce).to.be.true;
        expect(mockRedisLockStrategy.acquireLock.calledWith(lockId)).to.be.true;
      });

      it('should return null when strategy fails to acquire lock', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        mockRedisLockStrategy.acquireLock.resolves(null);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        const result = await lockService.acquireLock(lockId);

        expect(result).to.be.null;
        expect(mockRedisLockStrategy.acquireLock.calledWith(lockId)).to.be.true;
      });

      it('should handle errors from strategy gracefully', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        mockRedisLockStrategy.acquireLock.rejects(new Error('Redis connection error'));
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        await expect(lockService.acquireLock(lockId)).to.be.rejectedWith('Redis connection error');
      });

      it('should handle multiple concurrent acquisitions', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        const sessionKey1 = randomUUID();
        const sessionKey2 = randomUUID();
        mockRedisLockStrategy.acquireLock.onFirstCall().resolves(sessionKey1);
        mockRedisLockStrategy.acquireLock.onSecondCall().resolves(sessionKey2);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        const [result1, result2] = await Promise.all([lockService.acquireLock('0x1'), lockService.acquireLock('0x2')]);

        expect(result1).to.equal(sessionKey1);
        expect(result2).to.equal(sessionKey2);
        expect(mockRedisLockStrategy.acquireLock.callCount).to.equal(2);
      });
    });
  });

  describe('releaseLock', () => {
    describe('with LocalLockStrategy', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: false,
        REDIS_URL: '',
      });

      it('should successfully release lock', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        await lockService.releaseLock(lockId, sessionKey);

        expect(mockLocalLockStrategy.releaseLock.calledOnce).to.be.true;
        expect(mockLocalLockStrategy.releaseLock.calledWith(lockId, sessionKey)).to.be.true;
      });

      it('should handle release of non-existent lock gracefully', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        await expect(lockService.releaseLock('non-existent', sessionKey)).to.not.be.rejected;
        expect(mockLocalLockStrategy.releaseLock.calledWith('non-existent', sessionKey)).to.be.true;
      });

      it('should handle double release gracefully', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        await lockService.releaseLock(lockId, sessionKey);
        await expect(lockService.releaseLock(lockId, sessionKey)).to.not.be.rejected;

        expect(mockLocalLockStrategy.releaseLock.callCount).to.equal(2);
      });

      it('should handle multiple concurrent releases', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        await Promise.all([lockService.releaseLock('0x1', randomUUID()), lockService.releaseLock('0x2', randomUUID())]);

        expect(mockLocalLockStrategy.releaseLock.callCount).to.equal(2);
      });
    });

    describe('with RedisLockStrategy', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: true,
        REDIS_URL: 'redis://localhost:6379',
      });

      beforeEach(() => {
        // Mock Redis client to prevent actual connection
        const mockRedisClient = {
          connect: sinon.stub().resolves(),
          on: sinon.stub(),
        };
        sinon.stub(redisModule, 'createClient').returns(mockRedisClient as any);
      });

      it('should successfully release lock', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        await lockService.releaseLock(lockId, sessionKey);

        expect(mockRedisLockStrategy.releaseLock.calledOnce).to.be.true;
        expect(mockRedisLockStrategy.releaseLock.calledWith(lockId, sessionKey)).to.be.true;
      });

      it('should handle release of non-existent lock gracefully', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        await expect(lockService.releaseLock('non-existent', sessionKey)).to.not.be.rejected;
        expect(mockRedisLockStrategy.releaseLock.calledWith('non-existent', sessionKey)).to.be.true;
      });

      it('should handle double release gracefully', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        await lockService.releaseLock(lockId, sessionKey);
        await expect(lockService.releaseLock(lockId, sessionKey)).to.not.be.rejected;

        expect(mockRedisLockStrategy.releaseLock.callCount).to.equal(2);
      });

      it('should handle multiple concurrent releases', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        await Promise.all([lockService.releaseLock('0x1', randomUUID()), lockService.releaseLock('0x2', randomUUID())]);

        expect(mockRedisLockStrategy.releaseLock.callCount).to.equal(2);
      });
    });
  });

  describe('complete workflow', () => {
    describe('with LocalLockStrategy', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: false,
        REDIS_URL: '',
      });

      it('should complete acquire and release cycle', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        const acquiredSessionKey = await lockService.acquireLock(lockId);
        expect(acquiredSessionKey).to.equal(sessionKey);

        await lockService.releaseLock(lockId, acquiredSessionKey!);

        expect(mockLocalLockStrategy.acquireLock.calledOnce).to.be.true;
        expect(mockLocalLockStrategy.releaseLock.calledOnce).to.be.true;
      });

      it('should handle multiple sequential lock cycles', async () => {
        mockLocalLockStrategy = createMockLocalStrategy();
        const sessionKey1 = randomUUID();
        const sessionKey2 = randomUUID();
        mockLocalLockStrategy.acquireLock.onFirstCall().resolves(sessionKey1);
        mockLocalLockStrategy.acquireLock.onSecondCall().resolves(sessionKey2);
        stubLocalLockStrategyConstructor(mockLocalLockStrategy);

        lockService = new LockService(logger);

        // First cycle
        const key1 = await lockService.acquireLock(lockId);
        await lockService.releaseLock(lockId, key1!);

        // Second cycle
        const key2 = await lockService.acquireLock(lockId);
        await lockService.releaseLock(lockId, key2!);

        expect(mockLocalLockStrategy.acquireLock.callCount).to.equal(2);
        expect(mockLocalLockStrategy.releaseLock.callCount).to.equal(2);
        expect(key1).to.equal(sessionKey1);
        expect(key2).to.equal(sessionKey2);
      });
    });

    describe('with RedisLockStrategy', () => {
      overrideEnvsInMochaDescribe({
        REDIS_ENABLED: true,
        REDIS_URL: 'redis://localhost:6379',
      });

      beforeEach(() => {
        // Mock Redis client to prevent actual connection
        const mockRedisClient = {
          connect: sinon.stub().resolves(),
          on: sinon.stub(),
        };
        sinon.stub(redisModule, 'createClient').returns(mockRedisClient as any);
      });

      it('should complete acquire and release cycle', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        const acquiredSessionKey = await lockService.acquireLock(lockId);
        expect(acquiredSessionKey).to.equal(sessionKey);

        await lockService.releaseLock(lockId, acquiredSessionKey!);

        expect(mockRedisLockStrategy.acquireLock.calledOnce).to.be.true;
        expect(mockRedisLockStrategy.releaseLock.calledOnce).to.be.true;
      });

      it('should handle multiple sequential lock cycles', async () => {
        mockRedisLockStrategy = createMockRedisStrategy(true);
        const sessionKey1 = randomUUID();
        const sessionKey2 = randomUUID();
        mockRedisLockStrategy.acquireLock.onFirstCall().resolves(sessionKey1);
        mockRedisLockStrategy.acquireLock.onSecondCall().resolves(sessionKey2);
        stubRedisLockStrategyConstructor(mockRedisLockStrategy);

        lockService = new LockService(logger);

        // First cycle
        const key1 = await lockService.acquireLock(lockId);
        await lockService.releaseLock(lockId, key1!);

        // Second cycle
        const key2 = await lockService.acquireLock(lockId);
        await lockService.releaseLock(lockId, key2!);

        expect(mockRedisLockStrategy.acquireLock.callCount).to.equal(2);
        expect(mockRedisLockStrategy.releaseLock.callCount).to.equal(2);
        expect(key1).to.equal(sessionKey1);
        expect(key2).to.equal(sessionKey2);
      });
    });
  });
});
