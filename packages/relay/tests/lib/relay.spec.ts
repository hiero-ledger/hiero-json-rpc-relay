// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import fs from 'fs';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { Relay } from '../../src';
import { MirrorNodeClient } from '../../src/lib/clients/mirrorNodeClient';
import { MirrorNodeClientError } from '../../src/lib/errors/MirrorNodeClientError';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../helpers';

chai.use(chaiAsPromised);

describe('Relay', () => {
  const logger = pino({ level: 'silent' });
  const register = new Registry();
  let relay: Relay;

  beforeEach(async () => {
    sinon.stub(Relay.prototype, 'ensureOperatorHasBalance').resolves();
    // Prevent waitForMirrorNode from making real HTTP requests during non-connectivity tests
    sinon.stub(Relay.prototype, <any>'waitForMirrorNode').resolves();
    relay = await Relay.init(logger, register);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should initialize correctly with valid parameters', () => {
    expect(relay).to.be.an.instanceof(Relay);
  });

  it('should return the correct web3 implementation', () => {
    const web3 = relay.web3();
    expect(web3).to.not.be.undefined;
  });

  it('should return the correct net implementation', () => {
    const net = relay.net();
    expect(net).to.not.be.undefined;
  });

  it('should return the correct eth implementation', () => {
    const eth = relay.eth();
    expect(eth).to.not.be.undefined;
  });

  describe('populatePreconfiguredSpendingPlans', () => {
    let loggerSpy: sinon.SinonSpiedInstance<pino.Logger>;
    let populatePreconfiguredSpendingPlansSpy: sinon.SinonSpy;

    beforeEach(() => {
      loggerSpy = sinon.spy(logger);
      populatePreconfiguredSpendingPlansSpy = sinon.spy(Relay.prototype, <any>'populatePreconfiguredSpendingPlans');
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('when a configuration file is provided', () => {
      overrideEnvsInMochaDescribe({ HBAR_SPENDING_PLANS_CONFIG: 'spendingPlansConfig.example.json' });

      it('should populate preconfigured spending plans successfully', async () => {
        await expect(Relay.init(logger, register)).to.not.be.rejected;

        expect(populatePreconfiguredSpendingPlansSpy.calledOnce).to.be.true;
        await expect(populatePreconfiguredSpendingPlansSpy.returnValues[0]).to.not.be.rejected;
        expect(loggerSpy.info.calledWith('Pre-configured spending plans populated successfully')).to.be.true;
      });
    });

    describe('when no configuration file is provided', () => {
      const nonExistingFile = 'nonExistingFile.json';
      overrideEnvsInMochaDescribe({ HBAR_SPENDING_PLANS_CONFIG: nonExistingFile });

      it('should not throw an error', async () => {
        await expect(Relay.init(logger, register)).to.not.be.rejected;

        expect(populatePreconfiguredSpendingPlansSpy.calledOnce).to.be.true;
        await expect(populatePreconfiguredSpendingPlansSpy.returnValues[0]).to.not.be.rejected;
        // Verify no spending plans-related warnings were logged
        // (other warnings like deprecation notices may still be logged)
        expect(loggerSpy.warn.calledWith('Failed to load pre-configured spending plans')).to.be.false;
      });
    });

    describe('when a configuration file with invalid JSON is provided', () => {
      overrideEnvsInMochaDescribe({ HBAR_SPENDING_PLANS_CONFIG: 'spendingPlansConfig.example.json' });

      beforeEach(() => {
        sinon.stub(fs, 'readFileSync').returns('invalid JSON');
      });

      it('should log a warning', async () => {
        await expect(Relay.init(logger, register)).to.not.be.rejected;

        expect(populatePreconfiguredSpendingPlansSpy.calledOnce).to.be.true;
        await expect(populatePreconfiguredSpendingPlansSpy.returnValues[0]).not.to.be.rejected;

        expect(
          loggerSpy.warn.calledWith(
            'Failed to load pre-configured spending plans: %s',
            `File error: Unexpected token 'i', "invalid JSON" is not valid JSON`,
          ),
        ).to.be.true;
      });
    });
  });

  describe('ensureOperatorHasBalance', function () {
    beforeEach(() => {
      sinon.restore();
      // Allow waitForMirrorNode to pass through without real HTTP calls
      sinon.stub(MirrorNodeClient.prototype, 'checkServerReadiness').resolves();
    });

    withOverriddenEnvsInMochaTest({ READ_ONLY: true }, () => {
      it('should never throw', async function () {
        await expect(relay.initializeRelay()).to.not.be.rejectedWith();
      });
    });

    withOverriddenEnvsInMochaTest({ READ_ONLY: false }, () => {
      let operatorId: string;
      let getAccountPageLimitStub: sinon.SinonStub;

      beforeEach(() => {
        // @ts-expect-error: Property 'operatorAccountId' is private and only accessible within class 'Relay'.
        operatorId = relay.operatorAccountId!.toString();
        getAccountPageLimitStub = sinon.stub(MirrorNodeClient.prototype, 'getAccount');
      });

      afterEach(() => {
        getAccountPageLimitStub.restore();
      });

      it('should not throw when operator has balance', async function () {
        getAccountPageLimitStub.resolves({
          account: operatorId,
          balance: { balance: 99960581137 },
          transactions: [],
          links: {},
        });
        await expect(relay.initializeRelay()).to.not.be.rejectedWith();
      });

      it('should throw when operator has no balance', async function () {
        getAccountPageLimitStub.resolves({
          account: operatorId,
          balance: { balance: 0 },
          transactions: [],
          links: {},
        });

        const message = `Operator account '${operatorId}' has no balance`;
        await expect(relay.initializeRelay()).to.be.rejectedWith(message);
      });

      it('should throw when operator has not been found', async function () {
        getAccountPageLimitStub.resolves(null);

        const message = `Operator account '${operatorId}' has no balance`;
        await expect(relay.initializeRelay()).to.be.rejectedWith(message);
      });
    });
  });

  describe('waitForMirrorNode', function () {
    let checkServerReadinessStub: sinon.SinonStub;

    beforeEach(() => {
      sinon.restore();
      // Re-stub ensureOperatorHasBalance so these tests only exercise waitForMirrorNode
      sinon.stub(Relay.prototype, <any>'ensureOperatorHasBalance').resolves();
      checkServerReadinessStub = sinon.stub(MirrorNodeClient.prototype, 'checkServerReadiness').resolves();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should succeed when Mirror Node is reachable on the first attempt', async function () {
      await expect(relay.initializeRelay()).to.not.be.rejected;
      expect(checkServerReadinessStub.callCount).to.equal(1);
    });

    withOverriddenEnvsInMochaTest(
      { MIRROR_NODE_STARTUP_MAX_ATTEMPTS: 3, MIRROR_NODE_STARTUP_RETRY_DELAY_MS: 10 },
      () => {
        it('should succeed when Mirror Node becomes reachable after transient network failures', async function () {
          const networkError = new MirrorNodeClientError({ message: 'connect ECONNREFUSED' }, 567);
          checkServerReadinessStub.onCall(0).rejects(networkError);
          checkServerReadinessStub.onCall(1).rejects(networkError);
          checkServerReadinessStub.onCall(2).resolves();

          await expect(relay.initializeRelay()).to.not.be.rejected;
          expect(checkServerReadinessStub.callCount).to.equal(3);
        });
      },
    );

    withOverriddenEnvsInMochaTest(
      { MIRROR_NODE_STARTUP_MAX_ATTEMPTS: 2, MIRROR_NODE_STARTUP_RETRY_DELAY_MS: 10 },
      () => {
        it('should reject when Mirror Node remains unreachable after exhausting all attempts', async function () {
          const networkError = new MirrorNodeClientError({ message: 'connect ECONNREFUSED' }, 567);
          checkServerReadinessStub.rejects(networkError);

          await expect(relay.initializeRelay()).to.be.rejected;
          // MAX_ATTEMPTS=2 means loop runs for attempt 1, 2 → 2 total calls
          expect(checkServerReadinessStub.callCount).to.equal(2);
        });
      },
    );

    withOverriddenEnvsInMochaTest({ MIRROR_NODE_STARTUP_MAX_ATTEMPTS: 0 }, () => {
      it('should skip the connectivity check entirely when MIRROR_NODE_STARTUP_MAX_ATTEMPTS is 0', async function () {
        checkServerReadinessStub.rejects(new Error('should not be called'));

        await expect(relay.initializeRelay()).to.not.be.rejected;
        expect(checkServerReadinessStub.callCount).to.equal(0);
      });
    });

    withOverriddenEnvsInMochaTest({ READ_ONLY: true }, () => {
      it('should perform the connectivity check even in READ_ONLY mode', async function () {
        await expect(relay.initializeRelay()).to.not.be.rejected;
        expect(checkServerReadinessStub.callCount).to.equal(1);
      });
    });

    withOverriddenEnvsInMochaTest(
      { READ_ONLY: true, MIRROR_NODE_STARTUP_MAX_ATTEMPTS: 1, MIRROR_NODE_STARTUP_RETRY_DELAY_MS: 10 },
      () => {
        it('should reject in READ_ONLY mode when Mirror Node is unreachable', async function () {
          const networkError = new MirrorNodeClientError({ message: 'connect ECONNREFUSED' }, 567);
          checkServerReadinessStub.rejects(networkError);

          await expect(relay.initializeRelay()).to.be.rejected;
        });
      },
    );

    withOverriddenEnvsInMochaTest(
      { MIRROR_NODE_STARTUP_MAX_ATTEMPTS: 3, MIRROR_NODE_STARTUP_RETRY_DELAY_MS: 10 },
      () => {
        it('should not retry when Mirror Node returns a non-network HTTP error', async function () {
          const httpError = new MirrorNodeClientError({ message: 'Internal Server Error' }, 500);
          checkServerReadinessStub.rejects(httpError);

          await expect(relay.initializeRelay()).to.be.rejected;
          // Non-network errors must fail immediately without retrying
          expect(checkServerReadinessStub.callCount).to.equal(1);
        });
      },
    );
  });
});
