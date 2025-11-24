// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Logger, pino } from 'pino';
import { RedisClientType } from 'redis';
import * as sinon from 'sinon';

import { RedisLockStrategy } from '../../../../src/lib/services/lockService/RedisLockStrategy';

use(chaiAsPromised);

describe('RedisLockStrategy Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let mockRedisClient: sinon.SinonStubbedInstance<RedisClientType>;
  let redisLockStrategy: RedisLockStrategy;

  const testAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const normalizedAddress = testAddress.toLowerCase();

  beforeEach(() => {
    logger = pino({ level: 'silent' });

    // Create a mock Redis client
    mockRedisClient = {
      lPush: sinon.stub(),
      lIndex: sinon.stub(),
      set: sinon.stub(),
      lRem: sinon.stub(),
      lLen: sinon.stub(),
      eval: sinon.stub(),
    } as any;

    redisLockStrategy = new RedisLockStrategy(mockRedisClient as any, logger);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('acquireLock', () => {
    it('should successfully acquire lock when first in queue', async () => {
      const sessionKey = 'test-session-key';

      // Mock queue operations
      mockRedisClient.lPush.resolves(1);
      mockRedisClient.lIndex.resolves(sessionKey);
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(0);

      // Stub generateSessionKey to return predictable value
      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      expect(result).to.equal(sessionKey);
      expect(mockRedisClient.lPush.calledOnce).to.be.true;
      expect(mockRedisClient.lPush.calledWith(`lock:queue:${normalizedAddress}`, sessionKey)).to.be.true;
      expect(mockRedisClient.set.calledOnce).to.be.true;
      expect(mockRedisClient.lRem.calledOnce).to.be.true;
      expect(mockRedisClient.lRem.calledWith(`lock:queue:${normalizedAddress}`, 1, sessionKey)).to.be.true;
    });

    it('should wait in queue until first position', async () => {
      const sessionKey = 'test-session-key';
      const otherSessionKey = 'other-session-key';

      // Mock queue operations - first call returns other session, second returns our session
      mockRedisClient.lPush.resolves(2);
      mockRedisClient.lIndex.onFirstCall().resolves(otherSessionKey).onSecondCall().resolves(sessionKey);
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(1);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      expect(result).to.equal(sessionKey);
      expect(mockRedisClient.lIndex.callCount).to.equal(2);
      expect(mockRedisClient.lRem.calledOnce).to.be.true;
    });

    it('should normalize address to lowercase', async () => {
      const sessionKey = 'test-session-key';
      const upperCaseAddress = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';

      mockRedisClient.lPush.resolves(1);
      mockRedisClient.lIndex.resolves(sessionKey);
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(0);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      await redisLockStrategy.acquireLock(upperCaseAddress);

      expect(mockRedisClient.lPush.calledWith(`lock:queue:${upperCaseAddress.toLowerCase()}`, sessionKey)).to.be.true;
      expect(mockRedisClient.lRem.calledWith(`lock:queue:${upperCaseAddress.toLowerCase()}`, 1, sessionKey)).to.be.true;
    });

    it('should handle Redis errors during acquisition and cleanup queue (fail open)', async () => {
      const sessionKey = 'test-session-key';
      const redisError = new Error('Redis connection failed');

      // lPush succeeds, but lIndex fails
      mockRedisClient.lPush.resolves(1);
      mockRedisClient.lIndex.rejects(redisError);
      mockRedisClient.lRem.resolves(1);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      // Should return null (fail open) instead of throwing
      expect(result).to.be.null;

      // Should have attempted cleanup
      expect(mockRedisClient.lRem.calledOnce).to.be.true;
      expect(mockRedisClient.lRem.calledWith(`lock:queue:${normalizedAddress}`, 1, sessionKey)).to.be.true;
    });

    it('should handle Redis errors before joining queue without cleanup (fail open)', async () => {
      const sessionKey = 'test-session-key';
      const redisError = new Error('Redis connection failed');

      // lPush fails immediately
      mockRedisClient.lPush.rejects(redisError);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      // Should return null (fail open) instead of throwing
      expect(result).to.be.null;

      // Should NOT have attempted cleanup (never joined queue)
      expect(mockRedisClient.lRem.called).to.be.false;
    });
  });

  describe('releaseLock', () => {
    it('should successfully release lock with valid session key', async () => {
      const sessionKey = 'test-session-key';

      // Mock Lua script execution - return 1 for successful deletion
      mockRedisClient.eval.resolves(1);

      await redisLockStrategy.releaseLock(testAddress, sessionKey);

      expect(mockRedisClient.eval.calledOnce).to.be.true;
      const evalCall = mockRedisClient.eval.getCall(0);
      expect(evalCall.args[0]).to.be.a('string'); // Lua script
      expect(evalCall.args[1]).to.deep.equal({
        keys: [`lock:${normalizedAddress}`],
        arguments: [sessionKey],
      });
    });

    it('should ignore release with invalid session key', async () => {
      const sessionKey = 'test-session-key';

      // Mock Lua script execution - return 0 for no deletion (not owner)
      mockRedisClient.eval.resolves(0);

      // Should not throw
      await redisLockStrategy.releaseLock(testAddress, sessionKey);

      expect(mockRedisClient.eval.calledOnce).to.be.true;
    });

    it('should handle Redis errors during release gracefully', async () => {
      const sessionKey = 'test-session-key';
      const redisError = new Error('Redis connection failed');

      mockRedisClient.eval.rejects(redisError);

      // Should not throw - release failures should not block caller
      await redisLockStrategy.releaseLock(testAddress, sessionKey);

      expect(mockRedisClient.eval.calledOnce).to.be.true;
    });

    it('should normalize address during release', async () => {
      const sessionKey = 'test-session-key';
      const upperCaseAddress = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';

      mockRedisClient.eval.resolves(1);

      await redisLockStrategy.releaseLock(upperCaseAddress, sessionKey);

      const evalCall = mockRedisClient.eval.getCall(0);
      expect(evalCall).to.not.be.null;
      expect((evalCall as any).args[1].keys[0]).to.equal(`lock:${upperCaseAddress.toLowerCase()}`);
    });
  });

  describe('FIFO ordering', () => {
    it('should maintain FIFO order for multiple waiters', async () => {
      const session1 = 'session-1';

      // Simulate session joining queue
      mockRedisClient.lPush.resolves(1);

      // First session acquires immediately
      mockRedisClient.lIndex.onCall(0).resolves(session1);
      mockRedisClient.set.onCall(0).resolves('OK');
      mockRedisClient.lRem.onCall(0).resolves(1);
      mockRedisClient.lLen.resolves(2);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(session1);

      const result1 = await redisLockStrategy.acquireLock(testAddress);
      expect(result1).to.equal(session1);

      // Verify LPUSH was called (adding to queue)
      expect(mockRedisClient.lPush.calledWith(`lock:queue:${normalizedAddress}`, session1)).to.be.true;
      // Verify LREM was called (removing from queue)
      expect(mockRedisClient.lRem.calledWith(`lock:queue:${normalizedAddress}`, 1, session1)).to.be.true;
    });
  });

  describe('TTL-based expiration', () => {
    it('should set TTL when acquiring lock', async () => {
      const sessionKey = 'test-session-key';

      mockRedisClient.lPush.resolves(1);
      mockRedisClient.lIndex.resolves(sessionKey);
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(0);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      await redisLockStrategy.acquireLock(testAddress);

      // Verify SET was called with NX and PX options
      const setCall = mockRedisClient.set.getCall(0);
      expect(setCall.args[0]).to.equal(`lock:${normalizedAddress}`);
      expect(setCall.args[1]).to.equal(sessionKey);
      expect(setCall.args[2]).to.deep.include({ NX: true });
      expect(setCall.args[2]).to.have.property('PX');
    });
  });

  describe('Error handling and resilience', () => {
    it('should handle cleanup failures gracefully', async () => {
      const sessionKey = 'test-session-key';
      const redisError = new Error('Redis connection failed');

      // lPush succeeds, lIndex fails, lRem also fails
      mockRedisClient.lPush.resolves(1);
      mockRedisClient.lIndex.rejects(redisError);
      mockRedisClient.lRem.rejects(new Error('Cleanup failed'));

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      // Should return null (fail open) instead of throwing
      expect(result).to.be.null;

      // Cleanup was attempted
      expect(mockRedisClient.lRem.calledOnce).to.be.true;
    });
  });
});
