// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes, uuidV4 } from 'ethers';
import pino from 'pino';
import { Registry } from 'prom-client';
import { RedisClientType } from 'redis';
import sinon from 'sinon';

import { RedisClientManager } from '../../../../src/lib/clients/redisClientManager';
import { IPAddressHbarSpendingPlan } from '../../../../src/lib/db/entities/hbarLimiter/ipAddressHbarSpendingPlan';
import { IPAddressHbarSpendingPlanRepository } from '../../../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanNotFoundError } from '../../../../src/lib/db/types/hbarLimiter/errors';
import { IIPAddressHbarSpendingPlan } from '../../../../src/lib/db/types/hbarLimiter/ipAddressHbarSpendingPlan';
import { CacheService } from '../../../../src/lib/services/cacheService/cacheService';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer } from '../../../helpers';

chai.use(chaiAsPromised);

describe('IPAddressHbarSpendingPlanRepository', function () {
  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const ttl = 86_400_000; // 1 day
  const ipAddress = '555.555.555.555';
  const nonExistingIpAddress = 'xxx.xxx.xxx.xxx';

  const tests = (isSharedCacheEnabled: boolean) => {
    let cacheService: CacheService;
    let cacheServiceSpy: sinon.SinonSpiedInstance<CacheService>;
    let repository: IPAddressHbarSpendingPlanRepository;
    let redisClientManager: RedisClientManager;
    let redisClient: RedisClientType | undefined;

    if (isSharedCacheEnabled) {
      useInMemoryRedisServer(logger, 6383);
    } else {
      overrideEnvsInMochaDescribe({ REDIS_ENABLED: false });
    }
    before(async () => {
      if (isSharedCacheEnabled) {
        redisClientManager = new RedisClientManager(logger, 'redis://127.0.0.1:6383', 1000);
        await redisClientManager.connect();
        redisClient = redisClientManager.getClient();
      } else {
        redisClient = undefined;
      }
      cacheService = new CacheService(logger, registry);
      cacheServiceSpy = sinon.spy(cacheService);
      repository = new IPAddressHbarSpendingPlanRepository(
        cacheService,
        logger.child({ name: 'IPAddressHbarSpendingPlanRepository' }),
      );
    });

    afterEach(async () => {
      await cacheService.clear();
    });

    describe('existsByAddress', () => {
      it('returns true if address plan exists', async () => {
        const addressPlan = new IPAddressHbarSpendingPlan({ ipAddress, planId: uuidV4(randomBytes(16)) });
        await cacheService.set(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'test',
        );

        await expect(repository.existsByAddress(ipAddress)).to.eventually.be.true;
      });

      it('returns false if address plan does not exist', async () => {
        await expect(repository.existsByAddress(nonExistingIpAddress)).to.eventually.be.false;
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
          );
        }

        const result = await repository.findAllByPlanId(planId, 'findAllByPlanId');
        expect(result).to.have.deep.members(ipAddressPlans);
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
        const ipAddresses = ['555.555.555.555', '666.666.666.666'];
        for (const ipAddress of ipAddresses) {
          const addressPlan = new IPAddressHbarSpendingPlan({ ipAddress, planId });
          await cacheService.set(
            `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
            addressPlan,
            'test',
          );
        }

        await repository.deleteAllByPlanId(planId, 'deleteAllByPlanId');

        for (const ipAddress of ipAddresses) {
          await expect(
            cacheService.getAsync(`${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`, 'test'),
          ).to.eventually.be.null;
        }
      });

      it('does not throw an error if no address plans are found for the plan ID', async () => {
        const planId = uuidV4(randomBytes(16));
        await expect(repository.deleteAllByPlanId(planId, 'deleteAllByPlanId')).to.be.fulfilled;
      });
    });

    describe('findByAddress', () => {
      it('retrieves an address plan by ip', async () => {
        const addressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'test',
        );

        const result = await repository.findByAddress(ipAddress);
        expect(result).to.deep.equal(addressPlan);
      });

      it('throws an error if address plan is not found', async () => {
        await expect(repository.findByAddress(nonExistingIpAddress)).to.be.eventually.rejectedWith(
          IPAddressHbarSpendingPlanNotFoundError,
          `IPAddressHbarSpendingPlan not found`,
        );
      });
    });

    describe('save', () => {
      it('saves an address plan successfully', async () => {
        const addressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: uuidV4(randomBytes(16)) };

        await repository.save(addressPlan, ttl);
        const result = await cacheService.getAsync<IIPAddressHbarSpendingPlan>(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          'test',
        );
        expect(result).to.deep.equal(addressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'save',
          ttl,
        );
      });

      it('overwrites an existing address plan', async () => {
        const addressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: uuidV4(randomBytes(16)) };
        await cacheService.set(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          addressPlan,
          'test',
        );

        const newPlanId = uuidV4(randomBytes(16));
        const newAddressPlan: IIPAddressHbarSpendingPlan = { ipAddress, planId: newPlanId };
        await repository.save(newAddressPlan, ttl);
        const result = await cacheService.getAsync<IIPAddressHbarSpendingPlan>(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          'test',
        );
        expect(result).to.deep.equal(newAddressPlan);
        sinon.assert.calledWith(
          cacheServiceSpy.set,
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          newAddressPlan,
          'save',
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
        );

        await repository.delete(ipAddress);
        const result = await cacheService.getAsync<IIPAddressHbarSpendingPlan>(
          `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`,
          'test',
        );
        expect(result).to.be.null;
      });

      it('does not throw an error if address plan to delete does not exist', async () => {
        await expect(repository.delete(nonExistingIpAddress)).to.be.fulfilled;
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
