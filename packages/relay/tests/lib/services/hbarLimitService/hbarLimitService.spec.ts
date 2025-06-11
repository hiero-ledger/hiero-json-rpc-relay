// SPDX-License-Identifier: Apache-2.0

import { zeroAddress } from '@ethereumjs/util';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { AccountId, Hbar } from '@hashgraph/sdk';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes, uuidV4 } from 'ethers';
import pino, { Logger } from 'pino';
import { Counter, Gauge, Registry } from 'prom-client';
import sinon from 'sinon';

import { prepend0x } from '../../../../src/formatters';
import constants from '../../../../src/lib/constants';
import { HbarSpendingPlan } from '../../../../src/lib/db/entities/hbarLimiter/hbarSpendingPlan';
import { EvmAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import {
  EvmAddressHbarSpendingPlanNotFoundError,
  HbarSpendingPlanNotActiveError,
  HbarSpendingPlanNotFoundError,
} from '../../../../src/lib/db/types/hbarLimiter/errors';
import { IDetailedHbarSpendingPlan } from '../../../../src/lib/db/types/hbarLimiter/hbarSpendingPlan';
import { SubscriptionTier } from '../../../../src/lib/db/types/hbarLimiter/subscriptionTier';
import { CACHE_LEVEL, CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { HbarLimitService } from '../../../../src/lib/services/hbarLimitService';
import { RequestDetails } from '../../../../src/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../../helpers';

chai.use(chaiAsPromised);

describe('HBAR Rate Limit Service', function () {
  const logger = pino({ level: 'silent' });
  const register = new Registry();
  const totalBudgetInTinybars = constants.HBAR_RATE_LIMIT_TOTAL.toNumber();
  const limitDuration = constants.HBAR_RATE_LIMIT_DURATION;
  const mode = constants.EXECUTION_MODE.TRANSACTION;
  const methodName = 'testMethod';
  const txConstructorName = 'testConstructorName';
  const mockEvmAddress = '0x123';
  const mockIpAddress = 'x.x.x';
  const mockEstimatedTxFee = 300;
  const mockPlanId = uuidV4(randomBytes(16));
  const todayAtMidnight = new Date().setHours(0, 0, 0, 0);

  const requestDetails = new RequestDetails({ requestId: '', ipAddress: mockIpAddress });

  let cacheService: CacheService;
  let hbarLimitService: HbarLimitService;
  let hbarSpendingPlanRepository: HbarSpendingPlanRepository;
  let hbarSpendingPlanRepositorySpy: sinon.SinonSpiedInstance<HbarSpendingPlanRepository>;
  let evmAddressHbarSpendingPlanRepository: EvmAddressHbarSpendingPlanRepository;
  let evmAddressHbarSpendingPlanRepositorySpy: sinon.SinonSpiedInstance<EvmAddressHbarSpendingPlanRepository>;
  let ipAddressHbarSpendingPlanRepository: IPAddressHbarSpendingPlanRepository;
  let ipAddressHbarSpendingPlanRepositorySpy: sinon.SinonSpiedInstance<IPAddressHbarSpendingPlanRepository>;
  let loggerSpy: sinon.SinonSpiedInstance<Logger>;

  beforeEach(async function () {
    cacheService = CacheService.getInstance(CACHE_LEVEL.L1, register);
    loggerSpy = sinon.spy(logger);
    hbarSpendingPlanRepository = new HbarSpendingPlanRepository(
      cacheService,
      logger.child({ name: 'hbar-spending-plan-repository' }),
    );
    hbarSpendingPlanRepositorySpy = sinon.spy(hbarSpendingPlanRepository);
    evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(
      cacheService,
      logger.child({ name: 'evm-address-hbar-spending-plan-repository' }),
    );
    evmAddressHbarSpendingPlanRepositorySpy = sinon.spy(evmAddressHbarSpendingPlanRepository);
    ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(
      cacheService,
      logger.child({ name: 'ip-address-hbar-spending-plan-repository' }),
    );
    ipAddressHbarSpendingPlanRepositorySpy = sinon.spy(ipAddressHbarSpendingPlanRepository);
    hbarLimitService = new HbarLimitService(
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
      logger,
      register,
      limitDuration,
    );
    await CacheService.getInstance(CACHE_LEVEL.L1).clear(requestDetails);
  });

  afterEach(function () {
    sinon.restore();
  });

  function createSpendingPlan(id: string, amountSpent: number | Long | Hbar = 0) {
    return new HbarSpendingPlan({
      id,
      subscriptionTier: SubscriptionTier.BASIC,
      createdAt: new Date(),
      active: true,
      spendingHistory: [],
      amountSpent: amountSpent instanceof Hbar ? Number(amountSpent.toTinybars()) : Number(amountSpent),
    });
  }

  it('should initialize metrics correctly', () => {
    expect(hbarLimitService['hbarLimitCounter']).to.be.instanceOf(Counter);
    expect(hbarLimitService['hbarLimitRemainingGauge']).to.be.instanceOf(Gauge);
    Object.values(SubscriptionTier).forEach((tier) => {
      expect(hbarLimitService['uniqueSpendingPlansCounter'][tier]).to.be.instanceOf(Counter);
      expect(hbarLimitService['averageSpendingPlanAmountSpentGauge'][tier]).to.be.instanceOf(Gauge);
    });
  });

  it('should set the reset date properly', () => {
    const times = Math.ceil((Date.now() - todayAtMidnight) / limitDuration);
    const expectedDate = new Date(todayAtMidnight + limitDuration * times);
    const actualDate = hbarLimitService['reset'];
    expect(new Date(actualDate)).to.deep.equal(new Date(expectedDate));
  });

  describe('getResetTimestamp', function () {
    it('should return the current timestamp plus the limit duration', function () {
      const times = Math.ceil((Date.now() - todayAtMidnight) / limitDuration);
      const expectedDate = new Date(todayAtMidnight + limitDuration * times);
      const actualDate = hbarLimitService['reset'];
      expect(new Date(actualDate)).to.deep.equal(new Date(expectedDate));
      expect(hbarLimitService['getResetTimestamp']()).to.deep.equal(expectedDate);
    });

    describe('given a limit duration that is 1 day', function () {
      const limitDuration = 24 * 60 * 60 * 1000; // one day

      it('should return tomorrow at midnight', function () {
        const hbarLimitService = new HbarLimitService(
          hbarSpendingPlanRepository,
          evmAddressHbarSpendingPlanRepository,
          ipAddressHbarSpendingPlanRepository,
          logger,
          register,
          limitDuration,
        );
        const tomorrow = new Date(Date.now() + limitDuration);
        const tomorrowAtMidnight = new Date(tomorrow.setHours(0, 0, 0, 0));
        expect(hbarLimitService['getResetTimestamp']()).to.deep.equal(tomorrowAtMidnight);
      });
    });
  });

  describe('resetLimiter', function () {
    it('should reset the amountSpent field of all spending plans', async function () {
      await hbarLimitService.resetLimiter(requestDetails);
      expect(hbarSpendingPlanRepositorySpy.resetAmountSpentOfAllPlans.called).to.be.true;
    });

    it('should reset the remaining budget and update the gauge', async function () {
      // @ts-ignore
      hbarLimitService.remainingBudget = Hbar.fromTinybars(1000);
      const setSpy = sinon.spy(hbarLimitService['hbarLimitRemainingGauge'], 'set');
      await hbarLimitService.resetLimiter(requestDetails);
      expect((await hbarLimitService['getRemainingBudget'](requestDetails)).toTinybars().toNumber()).to.eq(
        totalBudgetInTinybars,
      );
      expect(setSpy.calledOnceWith(totalBudgetInTinybars)).to.be.true;
    });

    it('should set the reset date to the current timestamp plus the limit duration', async function () {
      const times = Math.ceil((Date.now() - todayAtMidnight) / limitDuration);
      const expectedDate = new Date(todayAtMidnight + limitDuration * times);
      await hbarLimitService.resetLimiter(requestDetails);
      const resetDate = hbarLimitService['reset'];
      expect(new Date(resetDate)).to.deep.equal(new Date(expectedDate));
    });
  });

  describe('shouldLimit', function () {
    const operatorEnvs = [
      { OPERATOR_ID_MAIN: ConfigService.get('OPERATOR_ID_MAIN') },
      { OPERATOR_ID_MAIN: zeroAddress() },
    ];

    operatorEnvs.forEach((operatorEnv) => {
      const operatorAddress = prepend0x(AccountId.fromString(operatorEnv.OPERATOR_ID_MAIN).toSolidityAddress());

      withOverriddenEnvsInMochaTest(operatorEnv, () => {
        describe('based on evmAddress', async function () {
          it('should return true if the total budget is exceeded', async function () {
            const operatorPlan = await hbarLimitService['getOperatorSpendingPlan'](requestDetails);
            await hbarSpendingPlanRepository.addToAmountSpent(
              operatorPlan.id,
              totalBudgetInTinybars,
              requestDetails,
              limitDuration,
            );
            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
            );
            expect(result).to.be.true;
          });

          it('should return true when remainingBudget < estimatedTxFee ', async function () {
            const operatorPlan = await hbarLimitService['getOperatorSpendingPlan'](requestDetails);
            await hbarSpendingPlanRepository.addToAmountSpent(
              operatorPlan.id,
              totalBudgetInTinybars - mockEstimatedTxFee + 1,
              requestDetails,
              limitDuration,
            );
            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
              mockEstimatedTxFee,
            );
            expect(result).to.be.true;
          });

          it('should create a basic spending plan if none exists for the evmAddress', async function () {
            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
            );

            expect(result).to.be.false;
            expect(hbarSpendingPlanRepositorySpy.create.getCalls().length).to.eq(2); // one for operator and one for evm address
            expect(evmAddressHbarSpendingPlanRepositorySpy.save.getCalls().length).to.eq(2); // same here
            expect(hbarSpendingPlanRepositorySpy.create.getCalls()[0].calledWith(SubscriptionTier.OPERATOR)).to.be.true;
            expect(
              evmAddressHbarSpendingPlanRepositorySpy.save
                .getCalls()[0]
                .calledWith({ evmAddress: operatorAddress, planId: sinon.match.string }),
            ).to.be.true;
            expect(hbarSpendingPlanRepositorySpy.create.getCalls()[1].calledWith(SubscriptionTier.BASIC)).to.be.true;
            expect(
              evmAddressHbarSpendingPlanRepositorySpy.save
                .getCalls()[1]
                .calledWith({ evmAddress: mockEvmAddress, planId: sinon.match.string }),
            ).to.be.true;
          });

          it('should return false if evmAddress and ipAddress is empty string', async function () {
            const requestDetails = new RequestDetails({ requestId: 'hbarLimterTest', ipAddress: '' });
            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);
            expect(result).to.be.false;
          });

          it('should return true if amountSpent is exactly at the limit', async function () {
            await evmAddressHbarSpendingPlanRepository.save(
              { evmAddress: mockEvmAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
            );

            expect(result).to.be.true;
          });

          it('should return false if amountSpent is just below the limit', async function () {
            await evmAddressHbarSpendingPlanRepository.save(
              { evmAddress: mockEvmAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().toNumber() - 1,
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
            );

            expect(result).to.be.false;
          });

          it('should return true if amountSpent is just above the limit', async function () {
            await evmAddressHbarSpendingPlanRepository.save(
              { evmAddress: mockEvmAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().toNumber() + 1,
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
            );

            expect(result).to.be.true;
          });

          it('should return true if amountSpent + estimatedTxFee is above the limit', async function () {
            await evmAddressHbarSpendingPlanRepository.save(
              { evmAddress: mockEvmAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC]
                .toTinybars()
                .sub(mockEstimatedTxFee)
                .add(1)
                .toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
              mockEstimatedTxFee,
            );

            expect(result).to.be.true;
          });

          it('should return false if amountSpent + estimatedTxFee is below the limit', async function () {
            await evmAddressHbarSpendingPlanRepository.save(
              { evmAddress: mockEvmAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC]
                .toTinybars()
                .sub(mockEstimatedTxFee)
                .sub(1)
                .toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
            );

            expect(result).to.be.false;
          });

          it('should return false if amountSpent + estimatedTxFee is at the limit', async function () {
            await evmAddressHbarSpendingPlanRepository.save(
              { evmAddress: mockEvmAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().sub(mockEstimatedTxFee).toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
            );

            expect(result).to.be.false;
          });
        });

        describe('based on ipAddress', async function () {
          it('should return true if the total budget is exceeded', async function () {
            const operatorPlan = await hbarLimitService['getOperatorSpendingPlan'](requestDetails);
            await hbarSpendingPlanRepository.addToAmountSpent(
              operatorPlan.id,
              totalBudgetInTinybars,
              requestDetails,
              limitDuration,
            );
            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);
            expect(result).to.be.true;
          });

          it('should return true when remainingBudget < estimatedTxFee ', async function () {
            const operatorPlan = await hbarLimitService['getOperatorSpendingPlan'](requestDetails);
            await hbarSpendingPlanRepository.addToAmountSpent(
              operatorPlan.id,
              totalBudgetInTinybars - mockEstimatedTxFee + 1,
              requestDetails,
              limitDuration,
            );
            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              '',
              requestDetails,
              mockEstimatedTxFee,
            );
            expect(result).to.be.true;
          });

          it('should return false if ipAddress is null or empty', async function () {
            const requestDetails = new RequestDetails({ requestId: 'hbarLimterTest', ipAddress: '' });
            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);
            expect(result).to.be.false;
          });

          it('should return true if amountSpent is exactly at the limit', async function () {
            await ipAddressHbarSpendingPlanRepository.save(
              { ipAddress: mockIpAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);

            expect(result).to.be.true;
          });

          it('should return false if amountSpent is just below the limit', async function () {
            await ipAddressHbarSpendingPlanRepository.save(
              { ipAddress: mockIpAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().sub(1).toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);

            expect(result).to.be.false;
          });

          it('should return true if amountSpent is just above the limit', async function () {
            await ipAddressHbarSpendingPlanRepository.save(
              { ipAddress: mockIpAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().add(1).toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);

            expect(result).to.be.true;
          });

          it('should return true if amountSpent + estimatedTxFee is above the limit', async function () {
            await ipAddressHbarSpendingPlanRepository.save(
              { ipAddress: mockIpAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC]
                .toTinybars()
                .sub(mockEstimatedTxFee)
                .add(1)
                .toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              '',
              requestDetails,
              mockEstimatedTxFee,
            );

            expect(result).to.be.true;
          });

          it('should return false if amountSpent + estimatedTxFee is below the limit', async function () {
            await ipAddressHbarSpendingPlanRepository.save(
              { ipAddress: mockIpAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC]
                .toTinybars()
                .sub(mockEstimatedTxFee)
                .sub(1)
                .toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);

            expect(result).to.be.false;
          });

          it('should return false if amountSpent + estimatedTxFee is at the limit', async function () {
            await ipAddressHbarSpendingPlanRepository.save(
              { ipAddress: mockIpAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().sub(mockEstimatedTxFee).toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitService.shouldLimit(mode, methodName, txConstructorName, '', requestDetails);

            expect(result).to.be.false;
          });
        });

        describe('disable the rate limiter', function () {
          let hbarLimitServiceDisabled: HbarLimitService;

          beforeEach(function () {
            hbarLimitServiceDisabled = new HbarLimitService(
              hbarSpendingPlanRepository,
              evmAddressHbarSpendingPlanRepository,
              ipAddressHbarSpendingPlanRepository,
              logger,
              register,
              limitDuration,
            );
            // @ts-ignore
            hbarLimitServiceDisabled['isHBarRateLimiterEnabled'] = false;
          });

          it('should return false if the rate limiter is disabled by setting HBAR_RATE_LIMIT_TINYBAR to zero', async function () {
            await evmAddressHbarSpendingPlanRepository.save(
              { evmAddress: mockEvmAddress, planId: mockPlanId },
              requestDetails,
              limitDuration,
            );
            await hbarSpendingPlanRepository.create(SubscriptionTier.BASIC, requestDetails, limitDuration, mockPlanId);
            await hbarSpendingPlanRepository.addToAmountSpent(
              mockPlanId,
              HbarLimitService.TIER_LIMITS[SubscriptionTier.BASIC].toTinybars().toNumber(),
              requestDetails,
              limitDuration,
            );

            const result = await hbarLimitServiceDisabled.shouldLimit(
              mode,
              methodName,
              txConstructorName,
              mockEvmAddress,
              requestDetails,
              mockEstimatedTxFee,
            );

            // Rate limiter is disabled, so it should return false
            expect(result).to.be.false;
          });

          it('should not add expenses if the rate limiter is disabled and addExpense is called', async function () {
            expect(await hbarLimitServiceDisabled.addExpense(100, mockEvmAddress, requestDetails)).to.be.undefined;
            expect(hbarSpendingPlanRepositorySpy.addToAmountSpent.notCalled).to.be.true;
          });
        });
      });
    });
  });

  describe('getSpendingPlan', function () {
    it(`should return null if neither evmAddress nor ipAddress is provided`, async function () {
      const ipAddresses = [''];
      const evmAddresses = [''];
      const testCases = evmAddresses.flatMap((evmAddress) =>
        ipAddresses.map((ipAddress) => ({ evmAddress, ipAddress })),
      );
      for (const { evmAddress, ipAddress } of testCases) {
        // @ts-ignore
        const requestDetails = new RequestDetails({ requestId: 'hbarLimterTest', ipAddress: ipAddress });
        const result = await hbarLimitService['getSpendingPlan'](evmAddress, requestDetails);
        expect(result).to.be.null;
      }
    });

    it('should return spending plan for evmAddress if evmAddress is provided', async function () {
      await evmAddressHbarSpendingPlanRepository.save(
        { evmAddress: mockEvmAddress, planId: mockPlanId },
        requestDetails,
        limitDuration,
      );
      const spendingPlan = await hbarSpendingPlanRepository.create(
        SubscriptionTier.BASIC,
        requestDetails,
        limitDuration,
        mockPlanId,
      );

      const result = await hbarLimitService['getSpendingPlan'](mockEvmAddress, requestDetails);

      expect(result).to.deep.equal(spendingPlan);
    });

    it('should return spending plan for ipAddress if ipAddress is provided', async function () {
      await ipAddressHbarSpendingPlanRepository.save(
        { ipAddress: mockIpAddress, planId: mockPlanId },
        requestDetails,
        limitDuration,
      );
      const spendingPlan = await hbarSpendingPlanRepository.create(
        SubscriptionTier.BASIC,
        requestDetails,
        limitDuration,
        mockPlanId,
      );

      const result = await hbarLimitService['getSpendingPlan']('', requestDetails);

      expect(result).to.deep.equal(spendingPlan);
    });

    it('should return null if no spending plan is found for evmAddress', async function () {
      const result = await hbarLimitService['getSpendingPlan'](mockEvmAddress, requestDetails);
      expect(result).to.be.null;
    });

    it('should return null if no spending plan is found for ipAddress', async function () {
      const result = await hbarLimitService['getSpendingPlan']('', requestDetails);
      expect(result).to.be.null;
    });
  });

  describe('getSpendingPlanByEvmAddress', function () {
    const testGetSpendingPlanByEvmAddressError = async (error: Error, errorClass: any) => {
      const result = hbarLimitService['getSpendingPlanByEvmAddress'](mockEvmAddress, requestDetails);
      await expect(result).to.be.eventually.rejectedWith(errorClass, error.message);
    };

    it('should handle error when getSpendingPlanByEvmAddress throws an EvmAddressHbarSpendingPlanNotFoundError', async function () {
      const error = new EvmAddressHbarSpendingPlanNotFoundError(mockEvmAddress);
      await testGetSpendingPlanByEvmAddressError(error, EvmAddressHbarSpendingPlanNotFoundError);
    });

    it('should handle error when getSpendingPlanByEvmAddress throws an HbarSpendingPlanNotFoundError', async function () {
      await evmAddressHbarSpendingPlanRepository.save(
        { evmAddress: mockEvmAddress, planId: mockPlanId },
        requestDetails,
        limitDuration,
      );
      const error = new HbarSpendingPlanNotFoundError(mockPlanId);
      await testGetSpendingPlanByEvmAddressError(error, HbarSpendingPlanNotFoundError);
    });

    it('should handle error when getSpendingPlanByEvmAddress throws an HbarSpendingPlanNotActiveError', async function () {
      await evmAddressHbarSpendingPlanRepository.save(
        { evmAddress: mockEvmAddress, planId: mockPlanId },
        requestDetails,
        limitDuration,
      );
      const spendingPlan = await hbarSpendingPlanRepository.create(
        SubscriptionTier.BASIC,
        requestDetails,
        limitDuration,
        mockPlanId,
      );
      await cacheService.set(
        `hbarSpendingPlan:${mockPlanId}`,
        { ...spendingPlan, active: false },
        'hbarLimitServiceTest',
        requestDetails,
      );
      const error = new HbarSpendingPlanNotActiveError(mockPlanId);
      await testGetSpendingPlanByEvmAddressError(error, HbarSpendingPlanNotActiveError);
    });

    it('should return the spending plan for the given evmAddress', async function () {
      await evmAddressHbarSpendingPlanRepository.save(
        { evmAddress: mockEvmAddress, planId: mockPlanId },
        requestDetails,
        limitDuration,
      );
      const spendingPlan = await hbarSpendingPlanRepository.create(
        SubscriptionTier.BASIC,
        requestDetails,
        limitDuration,
        mockPlanId,
      );

      const result = await hbarLimitService['getSpendingPlanByEvmAddress'](mockEvmAddress, requestDetails);

      expect(result).to.deep.equal(spendingPlan);
    });
  });

  describe('createSpendingPlanForAddress', function () {
    const testCreateSpendingPlanForAddress = async (evmAddress: string, ipAddress?: string) => {
      const requestDetails = new RequestDetails({ requestId: 'hbarLimitServiceTest', ipAddress: ipAddress ?? '' });

      const promise = hbarLimitService['createSpendingPlanForAddress'](evmAddress, requestDetails);

      if (evmAddress) {
        await expect(promise).eventually.to.deep.include({
          subscriptionTier: SubscriptionTier.BASIC,
          active: true,
          spendingHistory: [],
          amountSpent: 0,
        });
        expect(hbarSpendingPlanRepositorySpy.create.calledOnce).to.be.true;
        expect(ipAddressHbarSpendingPlanRepositorySpy.save.calledOnce).to.be.false;
        expect(evmAddressHbarSpendingPlanRepositorySpy.save.calledOnce).to.be.true;
      } else {
        await expect(promise).to.be.rejectedWith('Cannot create a spending plan without an associated evm address');
        expect(hbarSpendingPlanRepositorySpy.create.calledOnce).to.be.false;
        expect(ipAddressHbarSpendingPlanRepositorySpy.save.calledOnce).to.be.false;
        expect(evmAddressHbarSpendingPlanRepositorySpy.save.calledOnce).to.be.false;
      }
    };

    it('should create a basic spending plan for the given evmAddress', async function () {
      await testCreateSpendingPlanForAddress(mockEvmAddress);
    });

    it('should create a basic spending plan and link it only to the given evmAddress, if also an ipAddress is available', async function () {
      await testCreateSpendingPlanForAddress(mockEvmAddress, '127.0.0.1');
    });

    it('should throw an error if no evmAddress is provided', async function () {
      await testCreateSpendingPlanForAddress('');
    });
  });

  describe('addExpense', function () {
    const testAddExpense = async (evmAddress: string, ipAddress: string, expense: number = 100) => {
      const otherPlanOfTheSameTier = createSpendingPlan(uuidV4(randomBytes(16)), 200);
      await cacheService.set(
        `hbarSpendingPlan:${otherPlanOfTheSameTier.id}`,
        otherPlanOfTheSameTier,
        'hbarLimitServiceTest',
        requestDetails,
      );
      await cacheService.set(
        `hbarSpendingPlan:${otherPlanOfTheSameTier.id}:amountSpent`,
        otherPlanOfTheSameTier.amountSpent,
        'hbarLimitServiceTest',
        requestDetails,
      );

      const incUniqueSpendingPlansCounterSpy = sinon.spy(
        hbarLimitService['uniqueSpendingPlansCounter'][SubscriptionTier.BASIC],
        'inc',
      );
      const setAverageSpendingPlanAmountSpentGaugeSpy = sinon.spy(
        hbarLimitService['averageSpendingPlanAmountSpentGauge'][SubscriptionTier.BASIC],
        'set',
      );
      const updateAverageAmountSpentPerSubscriptionTierSpy = sinon.spy(
        hbarLimitService,
        <any>'updateAverageAmountSpentPerSubscriptionTier',
      );

      const addExpensePromise = hbarLimitService.addExpense(
        expense,
        evmAddress,
        new RequestDetails({
          ...requestDetails,
          ipAddress,
        }),
      );

      let operatorPlan: IDetailedHbarSpendingPlan;
      if (evmAddress) {
        await expect(addExpensePromise).to.eventually.be.fulfilled;
        sinon.assert.calledTwice(hbarSpendingPlanRepositorySpy.addToAmountSpent); // once for operator and once for evm address
        operatorPlan = await hbarLimitService['getOperatorSpendingPlan'](requestDetails);
        sinon.assert.calledWith(hbarSpendingPlanRepositorySpy.addToAmountSpent.firstCall, operatorPlan.id, expense);
        sinon.assert.calledWith(hbarSpendingPlanRepositorySpy.addToAmountSpent.secondCall, sinon.match.string, expense);
        await Promise.all(updateAverageAmountSpentPerSubscriptionTierSpy.returnValues);
        const expectedAverageUsage = Math.round((otherPlanOfTheSameTier.amountSpent + expense) / 2);
        sinon.assert.calledOnceWithExactly(setAverageSpendingPlanAmountSpentGaugeSpy, expectedAverageUsage);
        sinon.assert.calledOnceWithExactly(incUniqueSpendingPlansCounterSpy, 1);
      } else {
        await expect(addExpensePromise).to.eventually.be.fulfilled;
        sinon.assert.calledWith(
          loggerSpy.warn,
          `${requestDetails.formattedRequestId} Cannot add expense to a spending plan without an evm address`,
        );
        sinon.assert.calledOnce(hbarSpendingPlanRepositorySpy.addToAmountSpent); // only once for the operator
        operatorPlan = await hbarLimitService['getOperatorSpendingPlan'](requestDetails);
        sinon.assert.calledWith(hbarSpendingPlanRepositorySpy.addToAmountSpent.firstCall, operatorPlan.id, expense);
      }
      sinon.assert.calledWith(hbarSpendingPlanRepositorySpy.addToAmountSpent, sinon.match.string, expense);
      expect((await hbarLimitService['getRemainingBudget'](requestDetails)).toTinybars().toNumber()).to.eq(
        totalBudgetInTinybars - expense,
      );
      expect((await hbarLimitService['hbarLimitRemainingGauge'].get()).values[0].value).to.equal(
        totalBudgetInTinybars - expense,
      );
      expect(operatorPlan.amountSpent).to.eq(expense);
    };

    const operatorEnvs = [
      { OPERATOR_ID_MAIN: ConfigService.get('OPERATOR_ID_MAIN') },
      { OPERATOR_ID_MAIN: zeroAddress() },
    ];

    operatorEnvs.forEach((operatorEnv) => {
      const operatorAddress = operatorEnv.OPERATOR_ID_MAIN
        ? prepend0x(AccountId.fromString(operatorEnv.OPERATOR_ID_MAIN).toSolidityAddress())
        : zeroAddress();

      withOverriddenEnvsInMochaTest(operatorEnv, () => {
        it('should create a basic spending plan if none exists', async function () {
          await hbarLimitService.addExpense(100, mockEvmAddress, requestDetails);

          expect(hbarSpendingPlanRepositorySpy.create.getCalls().length).to.eq(2); // one for operator and one for evm address
          expect(evmAddressHbarSpendingPlanRepositorySpy.save.getCalls().length).to.eq(2); // same here
          expect(hbarSpendingPlanRepositorySpy.create.getCalls()[0].calledWith(SubscriptionTier.OPERATOR)).to.be.true;
          expect(
            evmAddressHbarSpendingPlanRepositorySpy.save
              .getCalls()[0]
              .calledWith({ evmAddress: operatorAddress, planId: sinon.match.string }),
          ).to.be.true;
          expect(hbarSpendingPlanRepositorySpy.create.getCalls()[1].calledWith(SubscriptionTier.BASIC)).to.be.true;
          expect(
            evmAddressHbarSpendingPlanRepositorySpy.save
              .getCalls()[1]
              .calledWith({ evmAddress: mockEvmAddress, planId: sinon.match.string }),
          ).to.be.true;
        });

        it('should add the expense to the spending plan and update the remaining budget when both evmAddress and ipAddress are provided', async function () {
          await testAddExpense(mockEvmAddress, '127.0.0.1');
        });

        it('should add the expense to the spending plan and update the remaining budget when evmAddress is provided but ipAddress is not', async function () {
          await testAddExpense(mockEvmAddress, '');
        });

        it('should add the expense to the spending plan and update the remaining budget when ipAddress is provided but evmAddress is not', async function () {
          await testAddExpense('', '127.0.0.1');
        });

        it('should handle errors when adding expense fails', async function () {
          await expect(
            hbarLimitService.addExpense(
              100,
              '',
              new RequestDetails({
                ...requestDetails,
                ipAddress: '',
              }),
            ),
          ).to.be.eventually.fulfilled;
          sinon.assert.calledWith(
            loggerSpy.warn,
            `${requestDetails.formattedRequestId} Cannot add expense to a spending plan without an evm address`,
          );
        });
      });
    });
  });

  describe('isTotalBudgetExceeded', function () {
    const testIsTotalBudgetExceeded = async (remainingBudget: number, expected: boolean) => {
      const operatorPlan = await hbarLimitService['getOperatorSpendingPlan'](requestDetails);
      await hbarSpendingPlanRepository.addToAmountSpent(
        operatorPlan.id,
        totalBudgetInTinybars - remainingBudget,
        requestDetails,
        limitDuration,
      );
      await expect(
        hbarLimitService['isTotalBudgetExceeded'](mode, methodName, txConstructorName, 0, requestDetails),
      ).to.eventually.equal(expected);
    };

    const operatorEnvs = [
      { OPERATOR_ID_MAIN: ConfigService.get('OPERATOR_ID_MAIN') },
      { OPERATOR_ID_MAIN: zeroAddress() },
    ];

    operatorEnvs.forEach((operatorEnv) => {
      withOverriddenEnvsInMochaTest(operatorEnv, () => {
        it('should return true when the remaining budget is zero', async function () {
          await testIsTotalBudgetExceeded(0, true);
        });

        it('should return true when the remaining budget is negative', async function () {
          await testIsTotalBudgetExceeded(-1, true);
        });

        it('should return false when the remaining budget is greater than zero', async function () {
          await testIsTotalBudgetExceeded(100, false);
        });

        it('should update the hbar limit counter when a method is called and the total budget is exceeded', async function () {
          // @ts-ignore
          const hbarLimitCounterSpy = sinon.spy(hbarLimitService.hbarLimitCounter, <any>'inc');
          await testIsTotalBudgetExceeded(0, true);
          expect(hbarLimitCounterSpy.calledWithMatch({ mode, methodName }, 1)).to.be.true;
        });

        it('should reset the limiter when the reset date is reached', async function () {
          // @ts-ignore
          hbarLimitService.reset = new Date();
          const resetLimiterSpy = sinon.spy(hbarLimitService, 'resetLimiter');
          await testIsTotalBudgetExceeded(0, false);
          expect(resetLimiterSpy.calledOnce).to.be.true;
        });
      });
    });
  });
});
