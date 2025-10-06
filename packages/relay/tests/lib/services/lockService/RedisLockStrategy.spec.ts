// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomUUID } from 'crypto';
import pino from 'pino';
import * as redisModule from 'redis';
import sinon from 'sinon';

import { RedisLockStrategy } from '../../../../src/lib/services/lockService/RedisLockStrategy';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

chai.use(chaiAsPromised);

describe('RedisLockStrategy Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const lockId = '0x123abc';
  const lockId2 = '0x456def';

  let redisLockStrategy: RedisLockStrategy;
  let mockRedisClient: any;
  let connectionListeners: Map<string, (...args: any[]) => void>;

  overrideEnvsInMochaDescribe({
    REDIS_ENABLED: true,
    REDIS_URL: 'redis://localhost:6379',
  });

  beforeEach(() => {
    connectionListeners = new Map();

    // Create comprehensive Redis client mock
    mockRedisClient = {
      connect: sinon.stub().resolves(),
      disconnect: sinon.stub().resolves(),
      quit: sinon.stub().resolves(),
      lPush: sinon.stub().resolves(1),
      lIndex: sinon.stub().resolves(null),
      lRem: sinon.stub().resolves(1),
      set: sinon.stub().resolves('OK'),
      get: sinon.stub().resolves(null),
      del: sinon.stub().resolves(1),
      eval: sinon.stub().resolves(1),
      on: sinon.stub().callsFake((event: string, listener: (...args: any[]) => void) => {
        connectionListeners.set(event, listener);
      }),
    };

    // Stub the redis module's createClient to return our mock
    sinon.stub(redisModule, 'createClient').returns(mockRedisClient);

    // Create strategy instance
    redisLockStrategy = new RedisLockStrategy(logger);

    // Simulate successful connection by triggering 'ready' event
    const readyListener = connectionListeners.get('ready');
    if (readyListener) {
      readyListener();
    }
  });

  afterEach(() => {
    sinon.restore();
  });

  // Helper functions to reduce repetition
  const buildLockKey = (id: string) => `lock:${id.toLowerCase()}`;
  const buildQueueKey = (id: string) => `lock:queue:${id}`;
  const simulateDisconnect = () => {
    const endListener = connectionListeners.get('end');
    if (endListener) {
      endListener();
    }
  };
  const overrideTimeouts = (strategy: RedisLockStrategy, acquisitionMs: number, ttlMs: number) => {
    Object.defineProperty(strategy, 'lockAcquisitionTimeoutMs', {
      value: acquisitionMs,
      writable: false,
      configurable: true,
    });
    Object.defineProperty(strategy, 'lockTtlMs', {
      value: ttlMs,
      writable: false,
      configurable: true,
    });
  };

  describe('initialization', () => {
    it('should initialize with Redis connection', () => {
      expect(mockRedisClient.connect.calledOnce).to.be.true;
      expect(redisLockStrategy.isConnected).to.be.true;
    });

    it('should register connection event handlers', () => {
      expect(mockRedisClient.on.callCount).to.be.at.least(3);
      expect(connectionListeners.has('ready')).to.be.true;
      expect(connectionListeners.has('end')).to.be.true;
      expect(connectionListeners.has('error')).to.be.true;
    });

    it('should handle connection failure gracefully', () => {
      sinon.restore();
      const failingClient = {
        ...mockRedisClient,
        connect: sinon.stub().rejects(new Error('Connection failed')),
      };
      sinon.stub(redisModule, 'createClient').returns(failingClient);

      const strategy = new RedisLockStrategy(logger);

      // Strategy should still be created but not connected
      expect(strategy).to.exist;
    });
  });

  describe('acquireLock', () => {
    describe('basic lock acquisition', () => {
      it('should successfully acquire lock when available', async () => {
        const lockKey = buildLockKey(lockId);
        const queueKey = buildQueueKey(lockId);

        // Mock Redis operations for successful acquisition
        mockRedisClient.lPush.resolves(1);
        mockRedisClient.lIndex.resolves(randomUUID()); // Session is first in queue
        mockRedisClient.set.resolves('OK');

        // Mock lIndex to return the session key on first call
        mockRedisClient.lIndex.callsFake(async () => {
          // Retrieves all the calls made to mockRedisClient.lPush so far
          const calls = mockRedisClient.lPush.getCalls();

          // Gets the most recent (last) call to lPush and extracts the session key argument
          return calls[calls.length - 1].args[1];
        });

        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.a('string');
        expect(sessionKey).to.have.lengthOf(36); // UUID length

        // Verify Redis operations were called correctly
        expect(mockRedisClient.lPush.calledWith(queueKey, sessionKey)).to.be.true;
        expect(mockRedisClient.set.calledWith(lockKey, sessionKey, { NX: true, PX: ConfigService.get('LOCK_TTL_MS') }))
          .to.be.true;
        expect(mockRedisClient.lRem.calledWith(queueKey, 1, sessionKey)).to.be.true;
      });

      it('should return unique session keys for each acquisition', async () => {
        let callCount = 0;

        mockRedisClient.lIndex.callsFake(async () => {
          const calls = mockRedisClient.lPush.getCalls();
          return calls[callCount++]?.args[1] || null;
        });
        mockRedisClient.set.resolves('OK');

        const sessionKey1 = await redisLockStrategy.acquireLock(lockId);
        const sessionKey2 = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey1).to.not.equal(sessionKey2);
        expect(mockRedisClient.lPush.callCount).to.equal(2);
      });

      it('should allow concurrent locks for different IDs', async () => {
        const queueKey1 = buildQueueKey(lockId);
        const queueKey2 = buildQueueKey(lockId2);

        mockRedisClient.lIndex.callsFake(async (key: string) => {
          const calls = mockRedisClient.lPush.getCalls();
          const call = calls.find((call: any) => call.args[0] === key);
          return call?.args[1] || null;
        });
        mockRedisClient.set.resolves('OK');

        const [sessionKey1, sessionKey2] = await Promise.all([
          redisLockStrategy.acquireLock(lockId),
          redisLockStrategy.acquireLock(lockId2),
        ]);

        expect(sessionKey1).to.be.a('string');
        expect(sessionKey2).to.be.a('string');
        expect(sessionKey1).to.not.equal(sessionKey2);

        // Verify operations for both locks
        expect(mockRedisClient.lPush.calledWith(queueKey1, sessionKey1)).to.be.true;
        expect(mockRedisClient.lPush.calledWith(queueKey2, sessionKey2)).to.be.true;
      });
    });

    describe('FIFO ordering', () => {
      it('should enforce FIFO for sequential requests', async () => {
        const sessionKeys: string[] = [];

        // Track session keys as they're enqueued
        mockRedisClient.lPush.callsFake(async (_key: string, value: string) => {
          sessionKeys.push(value);
          return sessionKeys.length;
        });

        // First call is first in queue, subsequent calls must wait
        let acquisitionCount = 0;
        mockRedisClient.lIndex.callsFake(async () => {
          if (acquisitionCount === 0) {
            acquisitionCount++;
            return sessionKeys[0]; // First request is first in queue
          }
          return null; // Others must wait
        });
        mockRedisClient.set.resolves('OK');

        const sessionKey1 = await redisLockStrategy.acquireLock(lockId);
        expect(sessionKey1).to.equal(sessionKeys[0]);
      });

      it('should handle waiting in queue', async () => {
        let pollCount = 0;
        const otherSessionUUID = randomUUID();

        // Session is first in queue after 2 polls
        mockRedisClient.lIndex.callsFake(async () => {
          pollCount++;
          if (pollCount > 2) {
            const calls = mockRedisClient.lPush.getCalls();
            return calls[calls.length - 1].args[1];
          }
          return otherSessionUUID; // Not first in queue yet
        });
        mockRedisClient.set.resolves('OK');

        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.a('string');
        expect(pollCount).to.be.greaterThan(2);
      });
    });

    describe('timeout behavior', () => {
      it('should timeout when acquisition exceeds timeout threshold', async () => {
        overrideTimeouts(redisLockStrategy, 500, 3000);
        const otherSessionUUID = randomUUID();

        // Always return different session (never first in queue)
        mockRedisClient.lIndex.resolves(otherSessionUUID);

        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.null; // Acquisition should fail and return null instead of throwing
        expect(mockRedisClient.lRem.called).to.be.true; // Cleanup should still occur
      });

      it('should cleanup queue on timeout', async () => {
        overrideTimeouts(redisLockStrategy, 500, 3000);
        const queueKey = buildQueueKey(lockId);
        const otherSessionUUID = randomUUID();

        mockRedisClient.lIndex.resolves(otherSessionUUID);

        await redisLockStrategy.acquireLock(lockId);

        // Verify cleanup was attempted
        expect(mockRedisClient.lRem.calledOnce).to.be.true;
        const lRemCall = mockRedisClient.lRem.getCall(0);
        expect(lRemCall.args[0]).to.equal(queueKey);
      });
    });

    describe('lock contention', () => {
      it('should wait when lock is held by another session', async () => {
        let pollCount = 0;

        // First poll: first in queue but lock is held
        // Second poll: lock becomes available
        mockRedisClient.lIndex.callsFake(async () => {
          const calls = mockRedisClient.lPush.getCalls();
          return calls[calls.length - 1].args[1];
        });

        mockRedisClient.set.callsFake(async () => {
          pollCount++;
          if (pollCount === 1) {
            return null; // Lock is held first call
          }
          return 'OK'; // Lock is now available after that
        });

        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.a('string');
        expect(pollCount).to.equal(2);
      });
    });

    describe('disconnection handling', () => {
      it('should return null when Redis is not connected', async () => {
        simulateDisconnect();

        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.null;
        expect(mockRedisClient.lPush.called).to.be.false;
      });

      it('should handle disconnection during acquisition', async () => {
        mockRedisClient.lIndex.callsFake(async () => {
          simulateDisconnect();
          throw new Error('Connection lost');
        });

        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.null;
      });
    });

    describe('edge cases', () => {
      it('should handle case-insensitive lock IDs', async () => {
        const lockKey = buildLockKey('0xabc');

        mockRedisClient.lIndex.callsFake(async () => {
          const calls = mockRedisClient.lPush.getCalls();
          return calls[calls.length - 1].args[1];
        });
        mockRedisClient.set.resolves('OK');

        const sessionKey = await redisLockStrategy.acquireLock('0xABC');

        expect(sessionKey).to.be.a('string');
        expect(mockRedisClient.set.calledWith(lockKey)).to.be.true;
      });

      it('should handle Redis errors gracefully', async () => {
        mockRedisClient.lPush.rejects(new Error('Redis error'));

        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.null;
      });

      it('should handle cleanup errors gracefully', async () => {
        mockRedisClient.lIndex.callsFake(async () => {
          const calls = mockRedisClient.lPush.getCalls();
          return calls[calls.length - 1].args[1];
        });
        mockRedisClient.set.resolves('OK');
        mockRedisClient.lRem.rejects(new Error('Cleanup failed'));

        // Should still return session key despite cleanup error
        const sessionKey = await redisLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.a('string');
      });

      const edgeCases = [
        { name: 'empty lock ID', lockId: '' },
        { name: 'very long lock ID', lockId: '0x' + 'a'.repeat(1000) },
        { name: 'special characters', lockId: '0x!@#$%^&*()' },
      ];

      edgeCases.forEach(({ name, lockId: testLockId }) => {
        it(`should handle ${name}`, async () => {
          mockRedisClient.lIndex.callsFake(async () => {
            const calls = mockRedisClient.lPush.getCalls();
            return calls[calls.length - 1].args[1];
          });
          mockRedisClient.set.resolves('OK');

          const sessionKey = await redisLockStrategy.acquireLock(testLockId);

          expect(sessionKey).to.be.a('string');
        });
      });
    });
  });

  describe('releaseLock', () => {
    describe('successful release', () => {
      it('should release valid lock using Lua script', async () => {
        const lockKey = buildLockKey(lockId);
        const sessionKey = randomUUID();

        // Mock successful Lua script execution (returns 1 = deleted)
        mockRedisClient.eval.resolves(1);

        await redisLockStrategy.releaseLock(lockId, sessionKey);

        // Verify Lua script was called with correct parameters
        expect(mockRedisClient.eval.calledOnce).to.be.true;
        const evalCall = mockRedisClient.eval.getCall(0);
        expect(evalCall.args[0]).to.include('redis.call("get", KEYS[1])');
        expect(evalCall.args[1]).to.deep.equal({
          keys: [lockKey],
          arguments: [sessionKey],
        });
      });

      it('should handle case-insensitive lock IDs', async () => {
        const lockKey = buildLockKey('0xabc');
        const sessionKey = randomUUID();

        mockRedisClient.eval.resolves(1);

        await redisLockStrategy.releaseLock('0xABC', sessionKey);

        const evalCall = mockRedisClient.eval.getCall(0);
        expect(evalCall.args[1].keys[0]).to.equal(lockKey);
      });
    });

    describe('invalid release attempts', () => {
      it('should ignore invalid session key', async () => {
        const sessionKey = randomUUID();

        // Lua script returns 0 = not deleted (session key mismatch)
        mockRedisClient.eval.resolves(0);

        await redisLockStrategy.releaseLock(lockId, sessionKey);

        expect(mockRedisClient.eval.calledOnce).to.be.true;
      });

      it('should ignore non-existent lock', async () => {
        mockRedisClient.eval.resolves(0);
        const sessionKey = randomUUID();

        // Should not throw error
        await expect(redisLockStrategy.releaseLock('non-existent', sessionKey)).to.not.be.rejected;
      });

      it('should handle double release gracefully', async () => {
        const sessionKey = randomUUID();

        // First release succeeds
        mockRedisClient.eval.onFirstCall().resolves(1);
        await redisLockStrategy.releaseLock(lockId, sessionKey);

        // Second release returns 0 (lock already released)
        mockRedisClient.eval.onSecondCall().resolves(0);
        await expect(redisLockStrategy.releaseLock(lockId, sessionKey)).to.not.be.rejected;

        expect(mockRedisClient.eval.callCount).to.equal(2);
      });

      it('should handle Redis errors during release', async () => {
        mockRedisClient.eval.rejects(new Error('Redis error'));
        const sessionKey = randomUUID();

        // Should not throw error - verify it completes without exception
        await expect(redisLockStrategy.releaseLock(lockId, sessionKey)).to.not.be.rejected;
      });
    });

    describe('disconnection handling', () => {
      it('should handle release when Redis is not connected', async () => {
        simulateDisconnect();
        const sessionKey = randomUUID();

        // Should not throw error
        await expect(redisLockStrategy.releaseLock(lockId, sessionKey)).to.not.be.rejected;

        expect(mockRedisClient.eval.called).to.be.false;
      });
    });
  });

  describe('TTL and expiration', () => {
    it('should set TTL on lock acquisition', async () => {
      mockRedisClient.lIndex.callsFake(async () => {
        const calls = mockRedisClient.lPush.getCalls();
        return calls[calls.length - 1].args[1];
      });
      mockRedisClient.set.resolves('OK');

      await redisLockStrategy.acquireLock(lockId);

      // Verify TTL was set via PX option
      const setCall = mockRedisClient.set.getCall(0);
      expect(setCall.args[2]).to.deep.include({ PX: ConfigService.get('LOCK_TTL_MS') });
    });

    it('should use NX flag for atomic acquisition', async () => {
      mockRedisClient.lIndex.callsFake(async () => {
        const calls = mockRedisClient.lPush.getCalls();
        return calls[calls.length - 1].args[1];
      });
      mockRedisClient.set.resolves('OK');

      await redisLockStrategy.acquireLock(lockId);

      // Verify NX flag was used
      const setCall = mockRedisClient.set.getCall(0);
      expect(setCall.args[2]).to.deep.include({ NX: true });
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple different lock IDs concurrently', async () => {
      const lockIds = ['0x1', '0x2', '0x3', '0x4', '0x5'];

      mockRedisClient.lIndex.callsFake(async (key: string) => {
        const calls = mockRedisClient.lPush.getCalls();
        const call = calls.find((c: any) => c.args[0] === key);
        return call?.args[1] || null;
      });
      mockRedisClient.set.resolves('OK');

      const sessionKeys = await Promise.all(lockIds.map((id) => redisLockStrategy.acquireLock(id)));

      sessionKeys.forEach((key) => expect(key).to.be.a('string'));
      expect(new Set(sessionKeys).size).to.equal(lockIds.length);
    });

    it('should handle interleaved acquire/release operations', async () => {
      let acquisitionCount = 0;

      mockRedisClient.lIndex.callsFake(async () => {
        const calls = mockRedisClient.lPush.getCalls();
        return calls[acquisitionCount++]?.args[1] || null;
      });
      mockRedisClient.set.resolves('OK');
      mockRedisClient.eval.resolves(1);

      const sessionKey1 = await redisLockStrategy.acquireLock(lockId);
      await redisLockStrategy.releaseLock(lockId, sessionKey1!);

      const sessionKey2 = await redisLockStrategy.acquireLock(lockId);
      await redisLockStrategy.releaseLock(lockId, sessionKey2!);

      expect(sessionKey1).to.be.a('string');
      expect(sessionKey2).to.be.a('string');
      expect(sessionKey1).to.not.equal(sessionKey2);
    });
  });

  describe('Lua script validation', () => {
    it('should use atomic Lua script for release', async () => {
      const sessionKey = randomUUID();
      mockRedisClient.eval.resolves(1);

      await redisLockStrategy.releaseLock(lockId, sessionKey);

      const evalCall = mockRedisClient.eval.getCall(0);
      const script = evalCall.args[0];

      // Verify script contains key validation and conditional delete
      expect(script).to.include('redis.call("get", KEYS[1])');
      expect(script).to.include('ARGV[1]');
      expect(script).to.include('redis.call("del", KEYS[1])');
    });

    it('should pass correct keys and arguments to Lua script', async () => {
      const lockKey = buildLockKey(lockId);
      const sessionKey = randomUUID();
      mockRedisClient.eval.resolves(1);

      await redisLockStrategy.releaseLock(lockId, sessionKey);

      const evalCall = mockRedisClient.eval.getCall(0);
      expect(evalCall.args[1]).to.deep.equal({
        keys: [lockKey],
        arguments: [sessionKey],
      });
    });
  });
});
