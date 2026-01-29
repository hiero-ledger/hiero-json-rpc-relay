// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { pino } from 'pino';
import sinon from 'sinon';

import { LocalLockStrategy, LockState } from '../../../../src/lib/services/lockService/LocalLockStrategy';
import { LockMetricsService } from '../../../../src/lib/services/lockService/LockMetricsService';
import { withOverriddenEnvsInMochaTest } from '../../../helpers';

describe('LocalLockStrategy', function () {
  this.timeout(10000);

  let lockStrategy: LocalLockStrategy;
  let mockMetricsService: sinon.SinonStubbedInstance<LockMetricsService>;

  beforeEach(() => {
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

    lockStrategy = new LocalLockStrategy(
      pino({ level: 'silent' }),
      mockMetricsService as unknown as LockMetricsService,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  function getStateEntry(address: string): LockState | null {
    return lockStrategy['localLockStates'].get(address);
  }

  it('should acquire and release a lock successfully', async () => {
    const address = 'test-address';

    const sessionKey = await lockStrategy.acquireLock(address);
    expect(sessionKey).to.be.a('string');

    const lockEntryAfterAcquisition = getStateEntry(address);
    expect(lockEntryAfterAcquisition.sessionKey).to.not.be.null;

    await lockStrategy.releaseLock(address, sessionKey);
    const lockEntryAfterRelease = getStateEntry(address);
    expect(lockEntryAfterRelease.sessionKey).to.be.null;
  });

  it('should not allow a non-owner to release a lock', async () => {
    const address = 'test-non-owner';
    const sessionKey = await lockStrategy.acquireLock(address);

    const lockEntryAfterAcquisition = getStateEntry(address);
    expect(lockEntryAfterAcquisition.sessionKey).to.equal(sessionKey);

    const wrongKey = 'fake-session';
    const doReleaseSpy = sinon.spy<any, any>(lockStrategy as any, 'doRelease');
    await lockStrategy.releaseLock(address, wrongKey);

    const lockEntryAfterFakeRelease = getStateEntry(address);
    expect(lockEntryAfterFakeRelease.sessionKey).to.equal(sessionKey);
    expect(doReleaseSpy.called).to.be.false;

    await lockStrategy.releaseLock(address, sessionKey);

    const lockEntryAfterRelease = getStateEntry(address);
    expect(lockEntryAfterRelease.sessionKey).to.be.null;
  });

  it('should block a second acquire until the first is released', async () => {
    const address = 'test-sequential';

    const sessionKey1 = await lockStrategy.acquireLock(address);
    let secondAcquired = false;

    const acquire2 = (async () => {
      const key2 = await lockStrategy.acquireLock(address);
      secondAcquired = true;
      await lockStrategy.releaseLock(address, key2);
    })();

    // Wait 100ms to ensure second acquire is blocked
    await new Promise((res) => setTimeout(res, 100));
    expect(secondAcquired).to.be.false;

    // Now release first
    await lockStrategy.releaseLock(address, sessionKey1);

    // Wait for second acquire to complete
    await acquire2;
    expect(secondAcquired).to.be.true;
  });

  withOverriddenEnvsInMochaTest({ LOCK_MAX_HOLD_MS: 200 }, () => {
    it('should auto-release after max lock time', async () => {
      const address = 'test-auto-release';

      const releaseSpy = sinon.spy<any, any>(lockStrategy as any, 'doRelease');
      await lockStrategy.acquireLock(address);

      // Wait beyond auto-release timeout
      await new Promise((res) => setTimeout(res, 300));

      expect(releaseSpy.called).to.be.true;
      const args = releaseSpy.getCall(0).args[0];
      expect(args.sessionKey).to.be.null;
    });
  });

  it('should reuse existing lock state for same address', async () => {
    const address = 'test-reuse';

    const state1 = lockStrategy['getOrCreateState'](address);
    const state2 = lockStrategy['getOrCreateState'](address);

    expect(state1).to.equal(state2);
  });

  it('should create a new lock state for new addresses', async () => {
    const stateA = lockStrategy['getOrCreateState']('a');
    const stateB = lockStrategy['getOrCreateState']('b');

    expect(stateA).to.not.equal(stateB);
  });

  it('should clear timeout and reset state on release', async () => {
    const address = 'test-reset';
    const sessionKey = await lockStrategy.acquireLock(address);
    const state = lockStrategy['localLockStates'].get(address);

    expect(state.sessionKey).to.equal(sessionKey);
    expect(state.lockTimeoutId).to.not.be.null;

    await lockStrategy.releaseLock(address, sessionKey);

    expect(state.sessionKey).to.be.null;
    expect(state.lockTimeoutId).to.be.null;
    expect(state.acquiredAt).to.be.null;
  });

  it('should ignore forceReleaseExpiredLock if session key does not match', async () => {
    const address = 'test-force-mismatch';
    const sessionKey = await lockStrategy.acquireLock(address);

    const state = lockStrategy['localLockStates'].get(address);
    expect(state.sessionKey).to.equal(sessionKey);

    // Modify session key to simulate ownership change
    state.sessionKey = 'different-key';

    const doReleaseSpy = sinon.spy<any, any>(lockStrategy as any, 'doRelease');
    await lockStrategy['forceReleaseExpiredLock'](address, sessionKey);

    expect(doReleaseSpy.called).to.be.false;

    await lockStrategy.releaseLock(address, 'different-key');
  });

  describe('Metrics verification', () => {
    it('should record metrics on successful lock acquisition', async () => {
      const address = 'test-metrics-acquire';
      const sessionKey = await lockStrategy.acquireLock(address);

      expect(mockMetricsService.incrementWaitingTxns.calledWith('local')).to.be.true;
      expect(mockMetricsService.recordWaitTime.calledOnce).to.be.true;
      expect(mockMetricsService.recordWaitTime.firstCall.args[0]).to.equal('local');
      expect(mockMetricsService.recordAcquisition.calledWith('local', 'success')).to.be.true;
      expect(mockMetricsService.incrementActiveCount.calledWith('local')).to.be.true;
      expect(mockMetricsService.decrementWaitingTxns.calledWith('local')).to.be.true;

      await lockStrategy.releaseLock(address, sessionKey);
    });

    it('should record metrics on lock release', async () => {
      const address = 'test-metrics-release';
      const sessionKey = await lockStrategy.acquireLock(address);

      mockMetricsService.recordHoldDuration.resetHistory();
      mockMetricsService.decrementActiveCount.resetHistory();

      await lockStrategy.releaseLock(address, sessionKey);

      expect(mockMetricsService.recordHoldDuration.calledOnce).to.be.true;
      expect(mockMetricsService.recordHoldDuration.firstCall.args[0]).to.equal('local');
      expect(mockMetricsService.recordHoldDuration.firstCall.args[1]).to.be.a('number');
      expect(mockMetricsService.decrementActiveCount.calledWith('local')).to.be.true;
    });

    it('should not record hold duration metrics when non-owner attempts release', async () => {
      const address = 'test-metrics-non-owner';
      const sessionKey = await lockStrategy.acquireLock(address);

      mockMetricsService.recordHoldDuration.resetHistory();
      mockMetricsService.decrementActiveCount.resetHistory();

      await lockStrategy.releaseLock(address, 'wrong-key');

      expect(mockMetricsService.recordHoldDuration.called).to.be.false;
      expect(mockMetricsService.decrementActiveCount.called).to.be.false;

      await lockStrategy.releaseLock(address, sessionKey);
    });

    withOverriddenEnvsInMochaTest({ LOCK_MAX_HOLD_MS: 200 }, () => {
      it('should record timeout release metrics when lock expires', async () => {
        const address = 'test-metrics-timeout';
        await lockStrategy.acquireLock(address);

        mockMetricsService.recordHoldDuration.resetHistory();
        mockMetricsService.recordTimeoutRelease.resetHistory();
        mockMetricsService.decrementActiveCount.resetHistory();

        // Wait beyond auto-release timeout
        await new Promise((res) => setTimeout(res, 300));

        expect(mockMetricsService.recordHoldDuration.calledOnce).to.be.true;
        expect(mockMetricsService.recordHoldDuration.firstCall.args[0]).to.equal('local');
        expect(mockMetricsService.recordTimeoutRelease.calledWith('local')).to.be.true;
        expect(mockMetricsService.decrementActiveCount.calledWith('local')).to.be.true;
      });
    });

    it('should decrement waiting transactions even when lock acquisition is blocked', async () => {
      const address = 'test-metrics-waiting';
      const sessionKey1 = await lockStrategy.acquireLock(address);

      mockMetricsService.incrementWaitingTxns.resetHistory();
      mockMetricsService.decrementWaitingTxns.resetHistory();

      // Start second acquire (will block)
      const acquire2Promise = lockStrategy.acquireLock(address);

      // Wait a bit for second acquire to start waiting
      await new Promise((res) => setTimeout(res, 50));

      expect(mockMetricsService.incrementWaitingTxns.calledWith('local')).to.be.true;

      // Release first lock
      await lockStrategy.releaseLock(address, sessionKey1);

      // Wait for second acquire to complete
      const sessionKey2 = await acquire2Promise;

      expect(mockMetricsService.decrementWaitingTxns.calledWith('local')).to.be.true;

      await lockStrategy.releaseLock(address, sessionKey2!);
    });
  });
});
