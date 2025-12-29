// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes, uuidV4 } from 'ethers';
import pino from 'pino';
import { Registry } from 'prom-client';
import { RedisClientType } from 'redis';
import sinon from 'sinon';

import { RedisClientManager } from '../../../../src/lib/clients/redisClientManager';
import { EvmAddressHbarSpendingPlan } from '../../../../src/lib/db/entities/hbarLimiter/evmAddressHbarSpendingPlan';
import { EvmAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { EvmAddressHbarSpendingPlanNotFoundError } from '../../../../src/lib/db/types/hbarLimiter/errors';
import { IEvmAddressHbarSpendingPlan } from '../../../../src/lib/db/types/hbarLimiter/evmAddressHbarSpendingPlan';
import { CacheClientFactory } from '../../../../src/lib/factories/cacheClientFactory';
import { CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('@evmAddressHbarSpendingPlanRepository EvmAddressHbarSpendingPlanRepository', function () {
  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const ttl = 86_400_000; // 1 day

  const tests = (isSharedCacheEnabled: boolean) => {
    let cacheService: CacheService;
    let cacheServiceSpy: sinon.SinonSpiedInstance<CacheService>;
    let repository: EvmAddressHbarSpendingPlanRepository;
    let redisClient: RedisClientType | undefined;

    if (isSharedCacheEnabled) {
      useInMemoryRedisServer(logger, 6382);
    } else {
      overrideEnvsInMochaDescribe({ REDIS_ENABLED: false });
    }

    before(async () => {
      if (isSharedCacheEnabled) {
        redisClient = await RedisClientManager.getClient(logger);
      } else {
        redisClient = undefined;
      }
      cacheService = new CacheService(CacheClientFactory.create(logger, registry, new Set(), redisClient), registry);
      cacheServiceSpy = sinon.spy(cacheService);
      repository = new EvmAddressHbarSpendingPlanRepository(
        cacheService,
        logger.child({ name: 'EvmAddressHbarSpendingPlanRepository' }),
      );
    });

    afterEach(async () => {
      await cacheService.clear();
    });

    describe('existsByAddress', () => {
      it('returns true if address plan exists', async () => {
        const evmAddress = '0x123';
        const addressPlan = new EvmAddressHbarSpendingPlan({ evmAddress, planId: uuidV4(randomBytes(16)) });
        await cacheService.set(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          addressPlan,
          'test',
        );

        await expect(repository.existsByAddress(evmAddress)).to.eventually.be.true;
      });

      it('returns false if address plan does not exist', async () => {
        const evmAddress = '0xnonexistent';
        await expect(repository.existsByAddress(evmAddress)).to.eventually.be.false;
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
          );
        }

        const result = await repository.findAllByPlanId(planId, 'findAllByPlanId');
        expect(result).to.have.deep.members(evmAddressPlans);
      });

      it('returns an empty array if no address plans are found for the plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        const result = await repository.findAllByPlanId(planId, 'findAllByPlanId');
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
          );
        }

        await repository.deleteAllByPlanId(planId, 'deleteAllByPlanId');

        for (const evmAddress of evmAddresses) {
          await expect(
            cacheService.getAsync(`${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`, 'test'),
          ).to.eventually.be.null;
        }
      });

      it('does not throw an error if no address plans are found for the plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        await expect(repository.deleteAllByPlanId(planId, 'deleteAllByPlanId')).to.be.fulfilled;
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
        );

        const result = await repository.findByAddress(evmAddress);
        expect(result).to.deep.equal(addressPlan);
      });

      it('throws an error if address plan is not found', async () => {
        const evmAddress = '0xnonexistent';
        await expect(repository.findByAddress(evmAddress)).to.be.eventually.rejectedWith(
          EvmAddressHbarSpendingPlanNotFoundError,
          `EvmAddressHbarSpendingPlan with address ${evmAddress} not found`,
        );
      });
    });

    describe('save', () => {
      it('saves an address plan successfully', async () => {
        const evmAddress = '0x123';
        const addressPlan: IEvmAddressHbarSpendingPlan = { evmAddress, planId: uuidV4(randomBytes(16)) };

        await repository.save(addressPlan, ttl);
        const result = await cacheService.getAsync<IEvmAddressHbarSpendingPlan>(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          'test',
        );
        expect(result).to.deep.equal(addressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          addressPlan,
          'save',
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
        );

        const newPlanId = uuidV4(randomBytes(16));
        const newAddressPlan: IEvmAddressHbarSpendingPlan = { evmAddress, planId: newPlanId };
        await repository.save(newAddressPlan, ttl);
        const result = await cacheService.getAsync<IEvmAddressHbarSpendingPlan>(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          'test',
        );
        expect(result).to.deep.equal(newAddressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          newAddressPlan,
          'save',
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
        );

        await repository.delete(evmAddress);
        const result = await cacheService.getAsync<IEvmAddressHbarSpendingPlan>(
          `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress}`,
          'test',
        );
        expect(result).to.be.null;
      });

      it('does not throw an error if address plan to delete does not exist', async () => {
        const evmAddress = '0xnonexistent';
        await expect(repository.delete(evmAddress)).to.be.fulfilled;
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
