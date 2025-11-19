// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { pino } from 'pino';
import sinon from 'sinon';

import { LocalLockStrategy, LockState } from '../../../../src/lib/services/lockService/LocalLockStrategy';
import { withOverriddenEnvsInMochaTest } from '../../../helpers';

describe('LocalLockStrategy', function () {
  this.timeout(10000);

  let lockStrategy: LocalLockStrategy;

  beforeEach(() => {
    lockStrategy = new LocalLockStrategy(pino({ level: 'silent' }));
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

  withOverriddenEnvsInMochaTest({ LOCAL_LOCK_MAX_LOCK_TIME: 200 }, () => {
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
});
