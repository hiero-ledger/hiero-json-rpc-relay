// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { HbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import {
  HbarSpendingPlanNotActiveError,
  HbarSpendingPlanNotFoundError,
} from '../../../../src/lib/db/types/hbarLimiter/errors';
import { IDetailedHbarSpendingPlan } from '../../../../src/lib/db/types/hbarLimiter/hbarSpendingPlan';
import { IHbarSpendingRecord } from '../../../../src/lib/db/types/hbarLimiter/hbarSpendingRecord';
import { SubscriptionTier } from '../../../../src/lib/db/types/hbarLimiter/subscriptionTier';
import { CACHE_LEVEL, CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { RequestDetails } from '../../../../src/lib/types';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('HbarSpendingPlanRepository', function () {
  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const requestDetails = new RequestDetails({ requestId: 'hbarSpendingPlanRepositoryTest', ipAddress: '0.0.0.0' });
  const ttl = 86_400_000; // 1 day

  const tests = (isSharedCacheEnabled: boolean) => {
    let cacheService: CacheService;
    let cacheServiceSpy: sinon.SinonSpiedInstance<CacheService>;
    let repository: HbarSpendingPlanRepository;

    before(async () => {
      // @ts-ignore
      CacheService.instances = [];
      cacheService = CacheService.getInstance(CACHE_LEVEL.L1, registry);
      cacheServiceSpy = sinon.spy(cacheService);
      repository = new HbarSpendingPlanRepository(cacheService, logger.child({ name: `HbarSpendingPlanRepository` }));
    });

    if (isSharedCacheEnabled) {
      useInMemoryRedisServer(logger, 6380);
    } else {
      overrideEnvsInMochaDescribe({ REDIS_ENABLED: false });
    }

    afterEach(async () => {
      await cacheService.clear(requestDetails);
    });

    after(async () => {
      await cacheService.disconnectRedisClient();
    });

    describe('create', () => {
      it('creates a plan successfully', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
        await expect(repository.findByIdWithDetails(createdPlan.id, requestDetails)).to.be.eventually.deep.equal(
          createdPlan,
        );
        sinon.assert.calledWithMatch(
          cacheServiceSpy.set,
          `${HbarSpendingPlanRepository.collectionKey}:${createdPlan.id}`,
          createdPlan,
          'create',
          requestDetails,
          ttl,
        );
      });
    });

    describe('findById', () => {
      it('throws an error if plan is not found by ID', async () => {
        await expect(repository.findById('non-existent-id', requestDetails)).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotFoundError,
          `HbarSpendingPlan with ID non-existent-id not found`,
        );
      });

      it('returns a plan by ID', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
        await expect(repository.findById(createdPlan.id, requestDetails)).to.be.eventually.deep.equal(createdPlan);
      });
    });

    describe('findByIdWithDetails', () => {
      it('throws an error if plan is not found by ID', async () => {
        await expect(repository.findByIdWithDetails('non-existent-id', requestDetails)).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotFoundError,
          `HbarSpendingPlan with ID non-existent-id not found`,
        );
      });

      it('returns a plan by ID', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
        await expect(repository.findByIdWithDetails(createdPlan.id, requestDetails)).to.be.eventually.deep.equal(
          createdPlan,
        );
      });
    });

    describe('getSpendingHistory', () => {
      it('throws an error if plan not found by ID', async () => {
        await expect(repository.getSpendingHistory('non-existent-id', requestDetails)).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotFoundError,
          `HbarSpendingPlan with ID non-existent-id not found`,
        );
      });

      it('returns an empty array if spending history is empty', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
        const spendingHistory = await repository.getSpendingHistory(createdPlan.id, requestDetails);
        expect(spendingHistory).to.deep.equal([]);
      });

      it('retrieves spending history for a plan', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);

        const key = `${HbarSpendingPlanRepository.collectionKey}:${createdPlan.id}:spendingHistory`;
        const hbarSpending = { amount: 100, timestamp: new Date() } as IHbarSpendingRecord;
        await cacheService.rPush(key, hbarSpending, 'test', requestDetails);

        const spendingHistory = await repository.getSpendingHistory(createdPlan.id, requestDetails);
        expect(spendingHistory).to.have.lengthOf(1);
        expect(spendingHistory[0].amount).to.equal(hbarSpending.amount);
        expect(spendingHistory[0].timestamp).to.be.a('Date');
      });
    });

    describe('addAmountToSpendingHistory', () => {
      it('adds amount to spending history', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
        await expect(repository.getSpendingHistory(createdPlan.id, requestDetails)).to.be.eventually.deep.equal([]);

        const amount = 100;
        await repository.addAmountToSpendingHistory(createdPlan.id, amount, requestDetails);

        const spendingHistory = await repository.getSpendingHistory(createdPlan.id, requestDetails);
        expect(spendingHistory).to.have.lengthOf(1);
        expect(spendingHistory[0].amount).to.equal(amount);
        expect(spendingHistory[0].timestamp).to.be.a('Date');

        sinon.assert.calledWithMatch(
          cacheServiceSpy.rPush,
          `${HbarSpendingPlanRepository.collectionKey}:${createdPlan.id}:spendingHistory`,
          { amount, timestamp: spendingHistory[0].timestamp },
          'addAmountToSpendingHistory',
          requestDetails,
        );
      });

      it('adds multiple amounts to spending history', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
        await expect(repository.getSpendingHistory(createdPlan.id, requestDetails)).to.be.eventually.deep.equal([]);

        const amounts = [100, 200, 300];
        for (const amount of amounts) {
          await repository.addAmountToSpendingHistory(createdPlan.id, amount, requestDetails);
        }

        const spendingHistory = await repository.getSpendingHistory(createdPlan.id, requestDetails);
        expect(spendingHistory).to.have.lengthOf(3);
        expect(spendingHistory.map((entry) => entry.amount)).to.deep.equal(amounts);
      });

      it('throws error if plan not found when adding to spending history', async () => {
        const id = 'non-existent-id';
        const amount = 100;

        await expect(repository.addAmountToSpendingHistory(id, amount, requestDetails)).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotFoundError,
          `HbarSpendingPlan with ID ${id} not found`,
        );
      });
    });

    describe('getAmountSpent', () => {
      let createdPlan: IDetailedHbarSpendingPlan;

      beforeEach(async () => {
        createdPlan = await repository.create(SubscriptionTier.BASIC, requestDetails, ttl);
      });

      it('retrieves amountSpent for a plan', async () => {
        const amount = 50;
        await repository.addToAmountSpent(createdPlan.id, amount, requestDetails, ttl);
        await expect(repository.getAmountSpent(createdPlan.id, requestDetails)).to.eventually.equal(amount);
      });

      it('returns 0 if amountSpent key does not exist', async () => {
        await expect(repository.getAmountSpent(createdPlan.id, requestDetails)).to.eventually.equal(0);
      });

      it('should expire amountSpent key at the end of the day', async () => {
        const amount = 50;
        const ttl = 100;
        await repository.addToAmountSpent(createdPlan.id, amount, requestDetails, ttl);
        await expect(repository.getAmountSpent(createdPlan.id, requestDetails)).to.eventually.equal(amount);

        await new Promise((resolve) => setTimeout(resolve, ttl + 100));

        await expect(repository.getAmountSpent(createdPlan.id, requestDetails)).to.eventually.equal(0);
      });
    });

    describe('resetAllAmountSpentEntries', () => {
      it('resets all amountSpent entries', async () => {
        const plans: IDetailedHbarSpendingPlan[] = [];
        for (const subscriptionTier of Object.values(SubscriptionTier)) {
          const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
          plans.push(createdPlan);
          const amount = 50 * plans.length;
          await repository.addToAmountSpent(createdPlan.id, amount, requestDetails, ttl);
          await expect(repository.getAmountSpent(createdPlan.id, requestDetails)).to.eventually.equal(amount);
        }

        await repository.resetAmountSpentOfAllPlans(requestDetails);

        for (const plan of plans) {
          await expect(repository.getAmountSpent(plan.id, requestDetails)).to.eventually.equal(0);
        }
      });

      it('does not throw an error if no amountSpent keys exist', async () => {
        await expect(repository.resetAmountSpentOfAllPlans(requestDetails)).to.not.be.rejected;
      });
    });

    describe('addToAmountSpent', () => {
      it('adds amount to amountSpent', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);
        const amount = 50;

        await repository.addToAmountSpent(createdPlan.id, amount, requestDetails, ttl);

        const plan = await repository.findByIdWithDetails(createdPlan.id, requestDetails);
        expect(plan).to.not.be.null;
        expect(plan!.amountSpent).to.equal(amount);
        sinon.assert.calledWithMatch(
          cacheServiceSpy.set,
          `${HbarSpendingPlanRepository.collectionKey}:${createdPlan.id}:amountSpent`,
          amount,
          'addToAmountSpent',
          requestDetails,
          ttl,
        );

        // Add more to amountSpent
        const newAmount = 100;
        await repository.addToAmountSpent(createdPlan.id, newAmount, requestDetails, ttl);
        sinon.assert.calledWithMatch(
          cacheServiceSpy.incrBy,
          `${HbarSpendingPlanRepository.collectionKey}:${createdPlan.id}:amountSpent`,
          newAmount,
          'addToAmountSpent',
          requestDetails,
        );

        const updatedPlan = await repository.findByIdWithDetails(createdPlan.id, requestDetails);
        expect(updatedPlan).to.not.be.null;
        expect(updatedPlan!.amountSpent).to.equal(amount + newAmount);
      });

      it('throws error if plan not found when adding to amountSpent', async () => {
        const id = 'non-existent-id';
        const amount = 50;

        await expect(repository.addToAmountSpent(id, amount, requestDetails, ttl)).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotFoundError,
          `HbarSpendingPlan with ID ${id} not found`,
        );
      });

      it('throws an error if plan is not active when adding to amountSpent', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);

        // Manually set the plan to inactive
        const key = `${HbarSpendingPlanRepository.collectionKey}:${createdPlan.id}`;
        await cacheService.set(key, { ...createdPlan, active: false }, 'test', requestDetails);

        const amount = 50;
        await expect(
          repository.addToAmountSpent(createdPlan.id, amount, requestDetails, ttl),
        ).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotActiveError,
          `HbarSpendingPlan with ID ${createdPlan.id} is not active`,
        );
      });
    });

    describe('checkExistsAndActive', () => {
      it('throws error if plan does not exist when checking if exists and active', async () => {
        const id = 'non-existent-id';
        await expect(repository.checkExistsAndActive(id, requestDetails)).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotFoundError,
          `HbarSpendingPlan with ID ${id} not found`,
        );
      });

      it('throws error if plan is not active when checking if exists and active', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan = await repository.create(subscriptionTier, requestDetails, ttl);

        // Manually set the plan to inactive
        const key = `${HbarSpendingPlanRepository.collectionKey}:${createdPlan.id}`;
        await cacheService.set(key, { ...createdPlan, active: false }, 'test', requestDetails);

        await expect(repository.checkExistsAndActive(createdPlan.id, requestDetails)).to.be.eventually.rejectedWith(
          HbarSpendingPlanNotActiveError,
          `HbarSpendingPlan with ID ${createdPlan.id} is not active`,
        );
      });
    });

    describe('findAllActiveBysubscriptionTier', () => {
      it('returns an empty array if no active plans exist for the subscription tier', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const activePlans = await repository.findAllActiveBySubscriptionTier([subscriptionTier], requestDetails);
        expect(activePlans).to.deep.equal([]);
      });

      it('returns all active plans for the subscription tier', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const createdPlan1 = await repository.create(subscriptionTier, requestDetails, ttl);
        const createdPlan2 = await repository.create(subscriptionTier, requestDetails, ttl);

        const activePlans = await repository.findAllActiveBySubscriptionTier([subscriptionTier], requestDetails);
        expect(activePlans).to.have.lengthOf(2);
        expect(activePlans.map((plan) => plan.id)).to.include.members([createdPlan1.id, createdPlan2.id]);
      });

      it('does not return inactive plans for the subscription tier', async () => {
        const subscriptionTier = SubscriptionTier.BASIC;
        const activePlan = await repository.create(subscriptionTier, requestDetails, ttl);
        const inactivePlan = await repository.create(subscriptionTier, requestDetails, ttl);

        // Manually set the plan to inactive
        const key = `${HbarSpendingPlanRepository.collectionKey}:${inactivePlan.id}`;
        await cacheService.set(key, { ...inactivePlan, active: false }, 'test', requestDetails);

        const activePlans = await repository.findAllActiveBySubscriptionTier([subscriptionTier], requestDetails);
        expect(activePlans).to.deep.equal([activePlan]);
      });

      it('returns only active plans for the specified subscription tier', async () => {
        const basicPlan = await repository.create(SubscriptionTier.BASIC, requestDetails, ttl);
        const extendedPlan = await repository.create(SubscriptionTier.EXTENDED, requestDetails, ttl);
        const privilegedPlan = await repository.create(SubscriptionTier.PRIVILEGED, requestDetails, ttl);

        const activeBasicPlans = await repository.findAllActiveBySubscriptionTier(
          [SubscriptionTier.BASIC],
          requestDetails,
        );
        expect(activeBasicPlans).to.have.lengthOf(1);
        expect(activeBasicPlans[0].id).to.equal(basicPlan.id);

        const activeExtendedPlans = await repository.findAllActiveBySubscriptionTier(
          [SubscriptionTier.EXTENDED],
          requestDetails,
        );
        expect(activeExtendedPlans).to.have.lengthOf(1);
        expect(activeExtendedPlans[0].id).to.equal(extendedPlan.id);

        const activePrivilegedPlans = await repository.findAllActiveBySubscriptionTier(
          [SubscriptionTier.PRIVILEGED],
          requestDetails,
        );
        expect(activePrivilegedPlans).to.have.lengthOf(1);
        expect(activePrivilegedPlans[0].id).to.equal(privilegedPlan.id);

        const activeBasicAndExtendedPlans = await repository.findAllActiveBySubscriptionTier(
          [SubscriptionTier.BASIC, SubscriptionTier.EXTENDED],
          requestDetails,
        );
        expect(activeBasicAndExtendedPlans).to.have.lengthOf(2);
        expect(activeBasicAndExtendedPlans.map((plan) => plan.id)).to.include.members([basicPlan.id, extendedPlan.id]);
      });
    });
  };

  describe('with shared cache', () => {
    tests(true);
  });

  describe('without shared cache', () => {
    tests(false);
  });
});
