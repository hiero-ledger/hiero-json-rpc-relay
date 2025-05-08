// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes, uuidV4 } from 'ethers';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { IPAddressHbarSpendingPlan } from '../../../../src/lib/db/entities/hbarLimiter/ipAddressHbarSpendingPlan';
import { IPAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanNotFoundError } from '../../../../src/lib/db/types/hbarLimiter/errors';
import { IIPAddressHbarSpendingPlan } from '../../../../src/lib/db/types/hbarLimiter/ipAddressHbarSpendingPlan';
import { CACHE_LEVEL, CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { RequestDetails } from '../../../../src/lib/types';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('IPAddressHbarSpendingPlanRepository', function () {
  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const requestDetails = new RequestDetails({
    requestId: 'ipAddressHbarSpendingPlanRepositoryTest',
    ipAddress: '0.0.0.0',
  });
  const ttl = 86_400_000; // 1 day
  const ipAddress = '555.555.555.555';
  const nonExistingIpAddress = 'xxx.xxx.xxx.xxx';

  const tests = (isSharedCacheEnabled: boolean) => {
    let cacheService: CacheService;
    let cacheServiceSpy: sinon.SinonSpiedInstance<CacheService>;
    let repository: IPAddressHbarSpendingPlanRepository;

    before(() => {
      // @ts-ignore
      CacheService.instances = [];
      cacheService = CacheService.getInstance(CACHE_LEVEL.L1, registry);
      cacheServiceSpy = sinon.spy(cacheService);
      repository = new IPAddressHbarSpendingPlanRepository(
        cacheService,
        logger.child({ name: 'IPAddressHbarSpendingPlanRepository' }),
      );
    });

    if (isSharedCacheEnabled) {
      useInMemoryRedisServer(logger, 6383);
    } else {
      overrideEnvsInMochaDescribe({ REDIS_ENABLED: false });
    }

    afterEach(async () => {
      await cacheService.clear(requestDetails);
    });

    after(async () => {
      await cacheService.disconnectRedisClient();
    });

    describe('existsByAddress', () => {
      it('returns true if address plan exists', async () => {
        const addressPlan = new IPAddressHbarSpendingPlan({ ipAddress, planId: uuidV4(randomBytes(16)) });
        await cacheService.set(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        await expect(repository.existsByAddress(ipAddress, requestDetails)).to.eventually.be.true;
      });

      it('returns false if address plan does not exist', async () => {
        await expect(repository.existsByAddress(nonExistingIpAddress, requestDetails)).to.eventually.be.false;
      });
    });

    describe('findAllByPlanId', () => {
      it('retrieves all address plans by plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        const ipAddressPlans = [
          new IPAddressHbarSpendingPlan({ ipAddress: '555.555.555.555', planId }),
          new IPAddressHbarSpendingPlan({ ipAddress: '666.666.666.666', planId }),
        ];
        for (const plan of ipAddressPlans) {
          await cacheService.set(
            `${IPAddressHbarSpendingPlanRepository.collectionKey}:${plan.ipAddress}`,
            plan,
            'test',
            requestDetails,
          );
        }

        const result = await repository.findAllByPlanId(planId, 'findAllByPlanId', requestDetails);
        expect(result).to.have.deep.members(ipAddressPlans);
      });

      it('returns an empty array if no address plans are found for the plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        const result = await repository.findAllByPlanId(planId, 'findAllByPlanId', requestDetails);
        expect(result).to.deep.equal([]);
      });
    });

    describe('deleteAllByPlanId', () => {
      it('deletes all address plans by plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        const ipAddresses = ['555.555.555.555', '666.666.666.666'];
        for (const ipAddress of ipAddresses) {
          const addressPlan = new IPAddressHbarSpendingPlan({ ipAddress, planId });
          await cacheService.set(
            `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
            addressPlan,
            'test',
            requestDetails,
          );
        }

        await repository.deleteAllByPlanId(planId, 'deleteAllByPlanId', requestDetails);

        for (const ipAddress of ipAddresses) {
          await expect(
            cacheService.getAsync(
              `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
              'test',
              requestDetails,
            ),
          ).to.eventually.be.null;
        }
      });

      it('does not throw an error if no address plans are found for the plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        await expect(repository.deleteAllByPlanId(planId, 'deleteAllByPlanId', requestDetails)).to.be.fulfilled;
      });
    });

    describe('findByAddress', () => {
      it('retrieves an address plan by ip', async () => {
        const addressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        const result = await repository.findByAddress(ipAddress, requestDetails);
        expect(result).to.deep.equal(addressPlan);
      });

      it('throws an error if address plan is not found', async () => {
        await expect(repository.findByAddress(nonExistingIpAddress, requestDetails)).to.be.eventually.rejectedWith(
          IPAddressHbarSpendingPlanNotFoundError,
          `IPAddressHbarSpendingPlan not found`,
        );
      });
    });

    describe('save', () => {
      it('saves an address plan successfully', async () => {
        const addressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: uuidV4(randomBytes(16)) };

        await repository.save(addressPlan, requestDetails, ttl);
        const result = await cacheService.getAsync<IIPAddressHbarSpendingPlan>(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          'test',
          requestDetails,
        );
        expect(result).to.deep.equal(addressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'save',
          requestDetails,
          ttl,
        );
      });

      it('overwrites an existing address plan', async () => {
        const addressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        const newPlanId = uuidV4(randomBytes(16));
        const newAddressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: newPlanId };
        await repository.save(newAddressPlan, requestDetails, ttl);
        const result = await cacheService.getAsync<IIPAddressHbarSpendingPlan>(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          'test',
          requestDetails,
        );
        expect(result).to.deep.equal(newAddressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          newAddressPlan,
          'save',
          requestDetails,
          ttl,
        );
      });
    });

    describe('delete', () => {
      it('deletes an address plan successfully', async () => {
        const addressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        await repository.delete(ipAddress, requestDetails);
        const result = await cacheService.getAsync<IIPAddressHbarSpendingPlan>(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          'test',
          requestDetails,
        );
        expect(result).to.be.null;
      });

      it('does not throw an error if address plan to delete does not exist', async () => {
        await expect(repository.delete(nonExistingIpAddress, requestDetails)).to.be.fulfilled;
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
