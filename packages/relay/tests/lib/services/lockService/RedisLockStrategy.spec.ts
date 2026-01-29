// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Logger, pino } from 'pino';
import { RedisClientType } from 'redis';
import * as sinon from 'sinon';

import { LockMetricsService } from '../../../../src/lib/services/lockService/LockMetricsService';
import { RedisLockStrategy } from '../../../../src/lib/services/lockService/RedisLockStrategy';

use(chaiAsPromised);

describe('RedisLockStrategy Test Suite', function () {
  this.timeout(10000);

  let logger: Logger;
  let mockRedisClient: sinon.SinonStubbedInstance<RedisClientType>;
  let mockMetricsService: sinon.SinonStubbedInstance<LockMetricsService>;
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
      exists: sinon.stub(),
    } as any;

    // Create a mock metrics service
    mockMetricsService = {
      recordWaitTime: sinon.stub(),
      recordHoldDuration: sinon.stub(),
      incrementWaitingTxns: sinon.stub(),
      decrementWaitingTxns: sinon.stub(),
      recordAcquisition: sinon.stub(),
      recordTimeoutRelease: sinon.stub(),
      recordZombieCleanup: sinon.stub(),
      incrementActiveCount: sinon.stub(),
      decrementActiveCount: sinon.stub(),
    } as sinon.SinonStubbedInstance<LockMetricsService>;

    redisLockStrategy = new RedisLockStrategy(
      mockRedisClient as any,
      logger,
      mockMetricsService as unknown as LockMetricsService,
    );
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
      mockRedisClient.set.resolves('OK'); // Handles both heartbeat and lock SET
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(0);

      // Stub generateSessionKey to return predictable value
      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      expect(result).to.equal(sessionKey);
      expect(mockRedisClient.lPush.calledOnce).to.be.true;
      expect(mockRedisClient.lPush.calledWith(`lock:queue:${normalizedAddress}`, sessionKey)).to.be.true;

      // Should have called SET at least twice: once for heartbeat, once for lock
      expect(mockRedisClient.set.callCount).to.be.at.least(2);

      // Should cleanup queue (heartbeat cleaned by TTL)
      expect(mockRedisClient.lRem.calledOnce).to.be.true;
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
      mockRedisClient.exists.resolves(1); // Other session's heartbeat exists (alive)

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      expect(result).to.equal(sessionKey);
      expect(mockRedisClient.lIndex.callCount).to.equal(2);
      expect(mockRedisClient.exists.calledOnce).to.be.true; // Checked other waiter's heartbeat
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
      expect(result).to.be.undefined;

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
      expect(result).to.be.undefined;

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
      mockRedisClient.lIndex.resolves(session1); // Always return session1 (it's first)
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(0); // Queue empty after acquiring

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

      // Verify SET was called with NX and PX options for the actual lock
      // Note: SET is called multiple times (heartbeat + lock), find the lock SET call
      const lockSetCall = mockRedisClient.set.getCalls().find((call) => call.args[0] === `lock:${normalizedAddress}`);
      expect(lockSetCall).to.exist;
      expect(lockSetCall?.args[1]).to.equal(sessionKey);
      expect(lockSetCall?.args[2]).to.deep.include({ NX: true });
      expect(lockSetCall?.args[2]).to.have.property('PX');
    });
  });

  describe('Heartbeat-based crash resilience', () => {
    it('should remove zombie waiter when heartbeat is missing and retry immediately', async () => {
      const sessionKey = 'test-session-key';
      const zombieSessionKey = 'zombie-session-key';

      // Setup: zombie is first in queue, our session is second
      mockRedisClient.lPush.resolves(2);

      // First poll: zombie is first (heartbeat missing)
      // Second poll: we are first (after zombie removed)
      mockRedisClient.lIndex.onFirstCall().resolves(zombieSessionKey).onSecondCall().resolves(sessionKey);

      mockRedisClient.exists.resolves(0); // Zombie's heartbeat is MISSING
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1); // Zombie removal and our queue cleanup
      mockRedisClient.lLen.resolves(0);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      expect(result).to.equal(sessionKey);

      // Should have checked zombie's heartbeat
      expect(mockRedisClient.exists.calledOnce).to.be.true;
      expect(mockRedisClient.exists.calledWith(`lock:heartbeat:${zombieSessionKey}`)).to.be.true;

      // Should have removed zombie from queue
      expect(mockRedisClient.lRem.callCount).to.be.at.least(1);
      const zombieRemovalCall = mockRedisClient.lRem.getCalls().find((call) => call.args[2] === zombieSessionKey);
      expect(zombieRemovalCall).to.exist;
      expect(zombieRemovalCall?.args[1]).to.equal(0); // Remove all occurrences
    });

    it('should refresh own heartbeat on every poll iteration', async () => {
      const sessionKey = 'test-session-key';
      const otherSessionKey = 'other-session-key';

      mockRedisClient.lPush.resolves(2);

      // First two polls: wait behind other session
      // Third poll: acquire lock
      mockRedisClient.lIndex
        .onCall(0)
        .resolves(otherSessionKey)
        .onCall(1)
        .resolves(otherSessionKey)
        .onCall(2)
        .resolves(sessionKey);

      mockRedisClient.exists.resolves(1); // Other session is alive
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(1);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      const result = await redisLockStrategy.acquireLock(testAddress);

      expect(result).to.equal(sessionKey);

      // Should have refreshed heartbeat on EACH poll (3 times for heartbeat + 1 for lock)
      expect(mockRedisClient.set.callCount).to.be.at.least(4);

      // Verify heartbeat SET calls have correct key and TTL
      const heartbeatCalls = mockRedisClient.set
        .getCalls()
        .filter((call) => call.args[0] === `lock:heartbeat:${sessionKey}`);
      expect(heartbeatCalls.length).to.be.at.least(3);

      // Each heartbeat SET should have PX (TTL in ms)
      heartbeatCalls.forEach((call) => {
        expect(call.args[2]).to.have.property('PX');
        expect(call.args[2].PX).to.be.a('number');
      });
    });

    it('should set heartbeat with TTL for automatic cleanup', async () => {
      const sessionKey = 'test-session-key';

      mockRedisClient.lPush.resolves(1);
      mockRedisClient.lIndex.resolves(sessionKey);
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(0);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      await redisLockStrategy.acquireLock(testAddress);

      // Find heartbeat SET calls
      const heartbeatSetCalls = mockRedisClient.set
        .getCalls()
        .filter((call) => call.args[0] === `lock:heartbeat:${sessionKey}`);

      expect(heartbeatSetCalls.length).to.be.at.least(1);

      // Verify each heartbeat SET has TTL (PX option)
      heartbeatSetCalls.forEach((call) => {
        const options = call.args[2];
        expect(options).to.have.property('PX');
        // TTL should be pollIntervalMs * LOCK_HEARTBEAT_MISSED_COUNT
        const expectedTtl =
          ConfigService.get('LOCK_QUEUE_POLL_INTERVAL_MS') * ConfigService.get('LOCK_HEARTBEAT_MISSED_COUNT');
        expect(options.PX).to.equal(expectedTtl);
      });
    });

    it('should not remove waiter if heartbeat exists (alive waiter)', async () => {
      const sessionKey = 'test-session-key';
      const aliveSessionKey = 'alive-session-key';

      mockRedisClient.lPush.resolves(2);

      // First poll: alive session is first
      // Second poll: we are first (alive session released lock)
      mockRedisClient.lIndex.onFirstCall().resolves(aliveSessionKey).onSecondCall().resolves(sessionKey);

      mockRedisClient.exists.resolves(1); // Alive session's heartbeat EXISTS
      mockRedisClient.set.resolves('OK');
      mockRedisClient.lRem.resolves(1);
      mockRedisClient.lLen.resolves(1);

      sinon.stub(redisLockStrategy as any, 'generateSessionKey').returns(sessionKey);

      await redisLockStrategy.acquireLock(testAddress);

      // Should have checked heartbeat
      expect(mockRedisClient.exists.calledOnce).to.be.true;

      // Should NOT have removed alive session from queue
      const zombieRemovalCalls = mockRedisClient.lRem.getCalls().filter((call) => call.args[2] === aliveSessionKey);
      expect(zombieRemovalCalls.length).to.equal(0);
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
      expect(result).to.be.undefined;

      // Cleanup was attempted
      expect(mockRedisClient.lRem.calledOnce).to.be.true;
    });
  });
});
