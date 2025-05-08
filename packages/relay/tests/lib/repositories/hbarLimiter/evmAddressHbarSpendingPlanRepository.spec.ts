// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes, uuidV4 } from 'ethers';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { RequestDetails } from '../../../../dist/lib/types';
import { EvmAddressHbarSpendingPlan } from '../../../../src/lib/db/entities/hbarLimiter/evmAddressHbarSpendingPlan';
import { EvmAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { EvmAddressHbarSpendingPlanNotFoundError } from '../../../../src/lib/db/types/hbarLimiter/errors';
import { IEvmAddressHbarSpendingPlan } from '../../../../src/lib/db/types/hbarLimiter/evmAddressHbarSpendingPlan';
import { CACHE_LEVEL, CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('EvmAddressHbarSpendingPlanRepository', function () {
  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const requestDetails = new RequestDetails({
    requestId: 'evmAddressHbarSpendingPlanRepositoryTest',
    ipAddress: '0.0.0.0',
  });
  const ttl = 86_400_000; // 1 day

  const tests = (isSharedCacheEnabled: boolean) => {
    let cacheService: CacheService;
    let cacheServiceSpy: sinon.SinonSpiedInstance<CacheService>;
    let repository: EvmAddressHbarSpendingPlanRepository;

    before(async () => {
      // @ts-ignore
      CacheService.instances = [];
      cacheService = CacheService.getInstance(CACHE_LEVEL.L1, registry);
      cacheServiceSpy = sinon.spy(cacheService);
      repository = new EvmAddressHbarSpendingPlanRepository(
        cacheService,
        logger.child({ name: 'EvmAddressHbarSpendingPlanRepository' }),
      );
    });

    if (isSharedCacheEnabled) {
      useInMemoryRedisServer(logger, 6382);
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
        const evmAddress = '0x123';
        const addressPlan = new EvmAddressHbarSpendingPlan({ evmAddress, planId: uuidV4(randomBytes(16)) });
        await cacheService.set(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        await expect(repository.existsByAddress(evmAddress, requestDetails)).to.eventually.be.true;
      });

      it('returns false if address plan does not exist', async () => {
        const evmAddress = '0xnonexistent';
        await expect(repository.existsByAddress(evmAddress, requestDetails)).to.eventually.be.false;
      });
    });

    describe('findAllByPlanId', () => {
      it('retrieves all address plans by plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        const evmAddressPlans = [
          new EvmAddressHbarSpendingPlan({ evmAddress: '0x123', planId }),
          new EvmAddressHbarSpendingPlan({ evmAddress: '0x456', planId }),
        ];
        for (const plan of evmAddressPlans) {
          await cacheService.set(
            `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${plan.evmAddress}`,
            plan,
            'test',
            requestDetails,
          );
        }

        const result = await repository.findAllByPlanId(planId, 'findAllByPlanId', requestDetails);
        expect(result).to.have.deep.members(evmAddressPlans);
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
        const evmAddresses = ['0x123', '0x456', '0x789'];
        for (const evmAddress of evmAddresses) {
          const addressPlan = new EvmAddressHbarSpendingPlan({ evmAddress, planId });
          await cacheService.set(
            `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
            addressPlan,
            'test',
            requestDetails,
          );
        }

        await repository.deleteAllByPlanId(planId, 'deleteAllByPlanId', requestDetails);

        for (const evmAddress of evmAddresses) {
          await expect(
            cacheService.getAsync(
              `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
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
      it('retrieves an address plan by address', async () => {
        const evmAddress = '0x123';
        const addressPlan: IEvmAddressHbarSpendingPlan = { evmAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        const result = await repository.findByAddress(evmAddress, requestDetails);
        expect(result).to.deep.equal(addressPlan);
      });

      it('throws an error if address plan is not found', async () => {
        const evmAddress = '0xnonexistent';
        await expect(repository.findByAddress(evmAddress, requestDetails)).to.be.eventually.rejectedWith(
          EvmAddressHbarSpendingPlanNotFoundError,
          `EvmAddressHbarSpendingPlan with address ${evmAddress} not found`,
        );
      });
    });

    describe('save', () => {
      it('saves an address plan successfully', async () => {
        const evmAddress = '0x123';
        const addressPlan: IEvmAddressHbarSpendingPlan = { evmAddress, planId: uuidV4(randomBytes(16)) };

        await repository.save(addressPlan, requestDetails, ttl);
        const result = await cacheService.getAsync<IEvmAddressHbarSpendingPlan>(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          'test',
          requestDetails,
        );
        expect(result).to.deep.equal(addressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          addressPlan,
          'save',
          requestDetails,
          ttl,
        );
      });

      it('overwrites an existing address plan', async () => {
        const evmAddress = '0x123';
        const addressPlan: IEvmAddressHbarSpendingPlan = { evmAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        const newPlanId = uuidV4(randomBytes(16));
        const newAddressPlan: IEvmAddressHbarSpendingPlan = { evmAddress, planId: newPlanId };
        await repository.save(newAddressPlan, requestDetails, ttl);
        const result = await cacheService.getAsync<IEvmAddressHbarSpendingPlan>(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          'test',
          requestDetails,
        );
        expect(result).to.deep.equal(newAddressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          newAddressPlan,
          'save',
          requestDetails,
          ttl,
        );
      });
    });

    describe('delete', () => {
      it('deletes an address plan successfully', async () => {
        const evmAddress = '0x123';
        const addressPlan: IEvmAddressHbarSpendingPlan = { evmAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          addressPlan,
          'test',
          requestDetails,
        );

        await repository.delete(evmAddress, requestDetails);
        const result = await cacheService.getAsync<IEvmAddressHbarSpendingPlan>(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          'test',
          requestDetails,
        );
        expect(result).to.be.null;
      });

      it('does not throw an error if address plan to delete does not exist', async () => {
        const evmAddress = '0xnonexistent';
        await expect(repository.delete(evmAddress, requestDetails)).to.be.fulfilled;
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
