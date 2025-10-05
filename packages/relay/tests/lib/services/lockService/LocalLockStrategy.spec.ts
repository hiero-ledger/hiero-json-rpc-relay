// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import * as sinon from 'sinon';

import { LocalLockStrategy } from '../../../../src/lib/services/lockService/LocalLockStrategy';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

chai.use(chaiAsPromised);

describe('LocalLockStrategy Test Suite', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const lockId = '0x123abc';
  const lockId2 = '0x456def';

  let localLockStrategy: LocalLockStrategy;

  overrideEnvsInMochaDescribe({
    LOCK_ACQUISITION_TIMEOUT_MS: 5000,
    LOCK_TTL_MS: 3000,
    LOCK_ACQUISITION_POLL_INTERVAL_MS: 50,
  });

  beforeEach(() => {
    localLockStrategy = new LocalLockStrategy(logger);
  });

  afterEach(() => {
    sinon.restore();
  });

  // Helper functions to reduce repetition
  const buildLockKey = (id: string) => localLockStrategy['buildLockKey'](id);
  const getLockStorage = () => localLockStrategy['lockStorage'];
  const getSessionQueues = () => localLockStrategy['sessionQueues'];
  const assertLockStored = (lockKey: string, sessionKey: string) => {
    expect(getLockStorage().has(lockKey)).to.be.true;
    expect(getLockStorage().get(lockKey)).to.equal(sessionKey);
  };
  const assertLockNotStored = (lockKey: string) => {
    expect(getLockStorage().has(lockKey)).to.be.false;
  };
  const assertQueueCleanedUp = (lockKey: string) => {
    expect(getSessionQueues().has(lockKey)).to.be.false;
  };
  const assertQueueExists = (lockKey: string, expectedLength?: number) => {
    const queue = getSessionQueues().get(lockKey);
    expect(queue).to.exist;
    if (expectedLength !== undefined) {
      expect(queue!.length).to.equal(expectedLength);
    }
    return queue!;
  };
  const overrideTimeouts = (acquisitionMs: number, ttlMs: number) => {
    Object.defineProperty(localLockStrategy, 'lockAcquisitionTimeoutMs', {
      value: acquisitionMs,
      writable: false,
      configurable: true,
    });
    Object.defineProperty(localLockStrategy, 'lockTtlMs', {
      value: ttlMs,
      writable: false,
      configurable: true,
    });
  };

  describe('acquireLock', () => {
    describe('basic lock acquisition', () => {
      it('should successfully acquire lock when available', async () => {
        const lockKey = buildLockKey(lockId);

        const sessionKey = await localLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.a('string');
        expect(sessionKey).to.have.lengthOf(36); // UUID length

        // Verify lock is stored in lockStorage with correct session key
        assertLockStored(lockKey, sessionKey!);

        // Verify session queue is cleaned up after successful acquisition
        assertQueueCleanedUp(lockKey);
      });

      it('should return unique session keys for each acquisition', async () => {
        const sessionKey1 = await localLockStrategy.acquireLock(lockId);
        await localLockStrategy.releaseLock(lockId, sessionKey1!);

        const sessionKey2 = await localLockStrategy.acquireLock(lockId);

        expect(sessionKey1).to.not.equal(sessionKey2);
      });

      it('should allow concurrent locks for different IDs', async () => {
        const lockKey1 = buildLockKey(lockId);
        const lockKey2 = buildLockKey(lockId2);

        const [sessionKey1, sessionKey2] = await Promise.all([
          localLockStrategy.acquireLock(lockId),
          localLockStrategy.acquireLock(lockId2),
        ]);

        expect(sessionKey1).to.be.a('string');
        expect(sessionKey2).to.be.a('string');
        expect(sessionKey1).to.not.equal(sessionKey2);

        // Verify both locks are stored independently
        assertLockStored(lockKey1, sessionKey1!);
        assertLockStored(lockKey2, sessionKey2!);
      });
    });

    describe('FIFO ordering', () => {
      it('should enforce FIFO for sequential requests', async () => {
        const lockKey = buildLockKey(lockId);

        const sessionKey1 = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey1).to.be.a('string');

        // Verify lock is stored in lockStorage
        assertLockStored(lockKey, sessionKey1!);

        // Second and third requests should wait and then acquire locks in order
        const promise2 = localLockStrategy.acquireLock(lockId);
        const promise3 = localLockStrategy.acquireLock(lockId);

        // Give time for promises to enqueue
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify queue exists and has pending items
        assertQueueExists(lockKey);

        // Release first lock
        await localLockStrategy.releaseLock(lockId, sessionKey1!);

        // Verify lock is removed from storage
        assertLockNotStored(lockKey);

        const sessionKey2 = await promise2;
        expect(sessionKey2).to.be.a('string');

        // Verify second lock is now stored
        assertLockStored(lockKey, sessionKey2!);

        // Release second lock
        await localLockStrategy.releaseLock(lockId, sessionKey2!);

        const sessionKey3 = await promise3;
        expect(sessionKey3).to.be.a('string');

        // Verify third lock is now stored
        assertLockStored(lockKey, sessionKey3!);
      });

      it('should track multiple waiters in queue', async () => {
        const lockKey = buildLockKey(lockId);

        // Acquire first lock
        const sessionKey1 = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey1).to.be.a('string');

        // Start 3 concurrent lock requests (all will wait)
        const promise2 = localLockStrategy.acquireLock(lockId);
        const promise3 = localLockStrategy.acquireLock(lockId);
        const promise4 = localLockStrategy.acquireLock(lockId);

        // Give time for promises to enqueue
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify queue has all 3 waiting sessions
        const queue = assertQueueExists(lockKey, 3);

        // Snapshot queue state for later verification
        // should have 3 session keys in order of arrival from right to left - [sessionKey4, sessionKey3, sessionKey2]
        const sessionKeysSnapshot = [...queue];

        // Release first lock and let second acquire
        await localLockStrategy.releaseLock(lockId, sessionKey1!);
        const sessionKey2 = await promise2;
        expect(sessionKey2).to.be.a('string');

        // Release second lock and let third acquire
        await localLockStrategy.releaseLock(lockId, sessionKey2!);
        const sessionKey3 = await promise3;
        expect(sessionKey3).to.be.a('string');

        // Release third lock and let fourth acquire
        await localLockStrategy.releaseLock(lockId, sessionKey3!);
        const sessionKey4 = await promise4;
        expect(sessionKey4).to.be.a('string');

        // Verify snapshot order matches acquisition order
        expect(sessionKeysSnapshot).to.deep.equal([sessionKey4, sessionKey3, sessionKey2]);
      });
    });

    describe('timeout behavior', () => {
      it('should timeout when acquisition exceeds timeout threshold', async function () {
        // For this test only: override config so acquisition timeout < TTL
        // This ensures lock is still held when acquisition timeout occurs
        overrideTimeouts(500, 3000); // Timeout < TTL
        const lockKey = buildLockKey(lockId);

        const sessionKey1 = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey1).to.be.a('string');

        // Verify first lock is stored
        assertLockStored(lockKey, sessionKey1!);

        // Second request should timeout (500ms) before lock expires (3000ms TTL)
        const sessionKey2 = await localLockStrategy.acquireLock(lockId);

        expect(sessionKey2).to.be.null;

        // Verify first lock is still held (didn't expire yet)
        assertLockStored(lockKey, sessionKey1!);

        // Verify queue was cleaned up after timeout
        assertQueueCleanedUp(lockKey);
      });
    });

    describe('queue lifecycle', () => {
      it('should manage queue through full lifecycle', async () => {
        const lockKey = buildLockKey(lockId);

        // Acquire first lock
        const sessionKey1 = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey1).to.be.a('string');

        // Queue should be cleaned up after successful acquisition
        assertQueueCleanedUp(lockKey);

        // Start second lock request (will wait since first is held and not yet released)
        const promise2 = localLockStrategy.acquireLock(lockId);

        // Give time for promise to enqueue
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify queue exists and has the waiting session
        const queue = assertQueueExists(lockKey, 1);

        // Save the queued session key for later verification
        const queuedSessionKey = queue[0];

        // Release first lock
        await localLockStrategy.releaseLock(lockId, sessionKey1!);

        // Second should acquire
        const sessionKey2 = await promise2;
        expect(sessionKey2).to.be.a('string');
        expect(sessionKey2).to.equal(queuedSessionKey); // Should match the queued session key

        // Verify lockStorage is updated with new session
        assertLockStored(lockKey, sessionKey2!);

        // Queue should be cleaned up after second acquisition
        assertQueueCleanedUp(lockKey);

        // Release second lock
        await localLockStrategy.releaseLock(lockId, sessionKey2!);

        // Verify complete cleanup
        assertLockNotStored(lockKey);
        assertQueueCleanedUp(lockKey);
      });
    });

    describe('edge cases', () => {
      it('should handle case-insensitive lock IDs', async () => {
        const sessionKey1 = await localLockStrategy.acquireLock('0xABC');

        // Call for wait in background
        const promise2 = localLockStrategy.acquireLock('0xabc');

        // Second request should wait because lock ID is normalized to lowercase
        expect(sessionKey1).to.be.a('string');

        await localLockStrategy.releaseLock('0xABC', sessionKey1!);

        const sessionKey2 = await promise2;
        expect(sessionKey2).to.be.a('string');
      });

      it('should handle errors gracefully', async () => {
        // Force an error by stubbing LRU cache
        sinon.stub(getLockStorage(), 'has').throws(new Error('Cache error'));

        const sessionKey = await localLockStrategy.acquireLock(lockId);

        expect(sessionKey).to.be.null;
      });

      const edgeCases = [
        { name: 'empty lock ID', lockId: '' },
        { name: 'very long lock ID', lockId: '0x' + 'a'.repeat(1000) },
        { name: 'special characters', lockId: '0x!@#$%^&*()' },
      ];

      edgeCases.forEach(({ name, lockId: testLockId }) => {
        it(`should handle ${name}`, async () => {
          const sessionKey = await localLockStrategy.acquireLock(testLockId);
          expect(sessionKey).to.be.a('string');
        });
      });
    });
  });

  describe('releaseLock', () => {
    describe('successful release', () => {
      it('should release valid lock', async () => {
        const lockKey = buildLockKey(lockId);

        const sessionKey = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey).to.be.a('string');

        // Verify lock exists in storage before release
        assertLockStored(lockKey, sessionKey!);

        await localLockStrategy.releaseLock(lockId, sessionKey!);

        // Verify lock is removed from storage after release
        assertLockNotStored(lockKey);

        // Verify lock is released by acquiring it again immediately
        const newSessionKey = await localLockStrategy.acquireLock(lockId);
        expect(newSessionKey).to.be.a('string');

        // Verify new lock is stored with new session key
        assertLockStored(lockKey, newSessionKey!);
      });

      it('should handle case-insensitive lock IDs', async () => {
        const sessionKey = await localLockStrategy.acquireLock('0xABC');

        await localLockStrategy.releaseLock('0xabc', sessionKey!);

        const newSessionKey = await localLockStrategy.acquireLock('0xABC');
        expect(newSessionKey).to.be.a('string');
      });
    });

    describe('invalid release attempts', () => {
      it('should ignore invalid session key', async () => {
        // For this test only: override config so acquisition timeout < TTL
        // This ensures lock is still held when acquisition timeout occurs
        overrideTimeouts(500, 3000); // Timeout < TTL
        const lockKey = buildLockKey(lockId);

        const sessionKey = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey).to.be.a('string');

        // Verify lock is stored
        assertLockStored(lockKey, sessionKey!);

        // Try to release with wrong session key
        await localLockStrategy.releaseLock(lockId, 'invalid-session-key');

        // Verify lock is STILL stored with original session key (not released)
        assertLockStored(lockKey, sessionKey!);

        // Verify lock is still held by checking if we can acquire it
        const sessionKey2 = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey2).to.be.null; // Should timeout because lock is still held
      });

      it('should ignore non-existent lock', async () => {
        // Should not throw error - verify it completes without exception
        await expect(localLockStrategy.releaseLock('non-existent', 'some-session')).to.not.be.rejected;
      });

      it('should handle double release gracefully', async () => {
        const lockKey = buildLockKey(lockId);

        const sessionKey = await localLockStrategy.acquireLock(lockId);
        expect(sessionKey).to.be.a('string');

        // Verify lock exists before first release
        assertLockStored(lockKey, sessionKey!);

        // First release
        await localLockStrategy.releaseLock(lockId, sessionKey!);

        // Verify lock was removed
        assertLockNotStored(lockKey);

        // Second release should complete without error
        await expect(localLockStrategy.releaseLock(lockId, sessionKey!)).to.not.be.rejected;

        // Verify still cleaned up
        assertLockNotStored(lockKey);
      });

      it('should handle errors during release', async () => {
        const lockKey = buildLockKey(lockId);
        const sessionKey = await localLockStrategy.acquireLock(lockId);

        sinon.stub(getLockStorage(), 'delete').throws(new Error('Delete error'));

        await expect(localLockStrategy.releaseLock(lockId, sessionKey!)).to.not.be.rejected;

        // Lock remains in storage due to error
        assertLockStored(lockKey, sessionKey!);
      });
    });
  });

  describe('TTL and expiration', () => {
    it('should auto-expire lock after TTL', async function () {
      const shortTtlStrategy = new LocalLockStrategy(logger);
      shortTtlStrategy['lockStorage']['ttl'] = 100;

      const sessionKey = await shortTtlStrategy.acquireLock(lockId);
      expect(sessionKey).to.be.a('string');

      // Wait past the TTL
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Lock should auto-expire and new acquisition should succeed
      const newSessionKey = await shortTtlStrategy.acquireLock(lockId);
      expect(newSessionKey).to.be.a('string');
      expect(newSessionKey).to.not.equal(sessionKey);
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple different lock IDs concurrently', async () => {
      const lockIds = ['0x1', '0x2', '0x3', '0x4', '0x5'];

      const sessionKeys = await Promise.all(lockIds.map((id) => localLockStrategy.acquireLock(id)));

      sessionKeys.forEach((key) => expect(key).to.be.a('string'));
      expect(new Set(sessionKeys).size).to.equal(lockIds.length);
    });

    it('should handle interleaved acquire/release operations', async () => {
      const sessionKey1 = await localLockStrategy.acquireLock(lockId);
      const promise2 = localLockStrategy.acquireLock(lockId);
      const promise3 = localLockStrategy.acquireLock(lockId);

      await localLockStrategy.releaseLock(lockId, sessionKey1!);

      const sessionKey2 = await promise2;

      // New request arrives while queue is being processed
      const promise4 = localLockStrategy.acquireLock(lockId);

      await localLockStrategy.releaseLock(lockId, sessionKey2!);

      // Both queued requests should eventually succeed
      const [sessionKey3, sessionKey4] = await Promise.all([promise3, promise4]);
      expect(sessionKey3).to.be.a('string');
      expect(sessionKey4).to.be.a('string');
    });
  });
});
