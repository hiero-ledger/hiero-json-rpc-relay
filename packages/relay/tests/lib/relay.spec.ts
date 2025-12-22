// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import fs from 'fs';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { Relay } from '../../src';
import { MirrorNodeClient } from '../../src/lib/clients/mirrorNodeClient';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../helpers';

chai.use(chaiAsPromised);

describe('Relay', () => {
  const logger = pino({ level: 'silent' });
  const register = new Registry();
  let relay: Relay;

  beforeEach(async () => {
    sinon.stub(Relay.prototype, 'ensureOperatorHasBalance').resolves();
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
        expect(loggerSpy.warn.notCalled).to.be.true;
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
});
