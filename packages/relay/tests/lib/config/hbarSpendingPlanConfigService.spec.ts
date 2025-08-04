// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import findConfig from 'find-config';
import fs from 'fs';
import pino, { Logger } from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { HbarSpendingPlanConfigService } from '../../../src/lib/config/hbarSpendingPlanConfigService';
import { HbarSpendingPlan } from '../../../src/lib/db/entities/hbarLimiter/hbarSpendingPlan';
import { HbarSpendingRecord } from '../../../src/lib/db/entities/hbarLimiter/hbarSpendingRecord';
import { EvmAddressHbarSpendingPlanRepository } from '../../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import {
  EvmAddressHbarSpendingPlanNotFoundError,
  HbarSpendingPlanNotFoundError,
  IPAddressHbarSpendingPlanNotFoundError,
} from '../../../src/lib/db/types/hbarLimiter/errors';
import { SubscriptionTier } from '../../../src/lib/db/types/hbarLimiter/subscriptionTier';
import { CACHE_LEVEL, CacheService } from '../../../src/lib/services/cacheService/cacheService';
import { RequestDetails } from '../../../src/lib/types';
import { SpendingPlanConfig } from '../../../src/lib/types/spendingPlanConfig';
import {
  overrideEnvsInMochaDescribe,
  toHex,
  useInMemoryRedisServer,
  verifyResult,
  withOverriddenEnvsInMochaTest,
} from '../../helpers';

chai.use(chaiAsPromised);

describe('HbarSpendingPlanConfigService', function () {
  const logger = pino({
    name: 'hbar-spending-plan-config-service',
    level: 'silent',
  });
  const registry = new Registry();
  const neverExpireTtl = -1;
  const emptyRequestDetails = new RequestDetails({ requestId: '', ipAddress: '' });
  const spendingPlansConfigFile = 'spendingPlansConfig.example.json';
  const path = findConfig(spendingPlansConfigFile);
  const spendingPlansConfig = JSON.parse(fs.readFileSync(path!, 'utf-8')) as SpendingPlanConfig[];

  describe('HbarSpendingPlan Entity Constructor', function () {
    it('should properly initialize spendingHistory and amountSpent with provided data', function () {
      const mockSpendingRecord = {
        id: 'test-record-1',
        hbarSpendingPlanId: 'test-plan-1',
        amount: 100,
        timestamp: new Date(),
      };

      const planData = {
        id: 'test-plan-1',
        subscriptionTier: SubscriptionTier.BASIC,
        spendingHistory: [mockSpendingRecord],
        amountSpent: 250,
        createdAt: new Date(),
        active: true,
      };

      const plan = new HbarSpendingPlan(planData);

      expect(plan.spendingHistory).to.have.lengthOf(1);
      expect(plan.spendingHistory[0]).to.be.instanceOf(HbarSpendingRecord);
      expect(plan.spendingHistory[0].amount).to.equal(100);
      expect(plan.amountSpent).to.equal(250);
    });

    it('should default spendingHistory to empty array and amountSpent to 0 when not provided', function () {
      const planData = {
        id: 'test-plan-2',
        subscriptionTier: SubscriptionTier.EXTENDED,
        spendingHistory: [],
        amountSpent: 0,
        createdAt: new Date(),
        active: true,
      };

      const plan = new HbarSpendingPlan(planData);

      expect(plan.spendingHistory).to.be.an('array');
      expect(plan.spendingHistory).to.have.lengthOf(0);
      expect(plan.amountSpent).to.equal(0);
    });

    it('should handle optional spendingHistory and amountSpent fields correctly', function () {
      const planData = {
        id: 'test-plan-3',
        subscriptionTier: SubscriptionTier.PRIVILEGED,
        spendingHistory: [],
        amountSpent: 0,
        createdAt: new Date(),
        active: true,
      };

      const plan = new HbarSpendingPlan(planData);

      expect(plan.spendingHistory).to.be.an('array');
      expect(plan.spendingHistory).to.have.lengthOf(0);
      expect(plan.amountSpent).to.equal(0);
    });

    it('should handle undefined spendingHistory and amountSpent fields', function () {
      const planData = {
        id: 'test-plan-4',
        subscriptionTier: SubscriptionTier.BASIC,
        createdAt: new Date(),
        active: true,
      } as any; // Use 'as any' to test runtime behavior when properties are undefined

      const plan = new HbarSpendingPlan(planData);

      expect(plan.spendingHistory).to.be.an('array');
      expect(plan.spendingHistory).to.have.lengthOf(0);
      expect(plan.amountSpent).to.equal(0);
    });

    it('should handle null spendingHistory and amountSpent fields', function () {
      const planData = {
        id: 'test-plan-5',
        subscriptionTier: SubscriptionTier.EXTENDED,
        spendingHistory: null,
        amountSpent: null,
        createdAt: new Date(),
        active: true,
      } as any; // Use 'as any' to test runtime behavior when properties are null

      const plan = new HbarSpendingPlan(planData);

      expect(plan.spendingHistory).to.be.an('array');
      expect(plan.spendingHistory).to.have.lengthOf(0);
      expect(plan.amountSpent).to.equal(0);
    });
  });

  const tests = (hbarSpendingPlansConfigEnv: string) => {
    let cacheService: CacheService;
    let hbarSpendingPlanRepository: HbarSpendingPlanRepository;
    let evmAddressHbarSpendingPlanRepository: EvmAddressHbarSpendingPlanRepository;
    let ipAddressHbarSpendingPlanRepository: IPAddressHbarSpendingPlanRepository;
    let hbarSpendingPlanConfigService: HbarSpendingPlanConfigService;

    let loggerSpy: sinon.SinonSpiedInstance<Logger>;
    let cacheServiceSpy: sinon.SinonSpiedInstance<CacheService>;
    let hbarSpendingPlanRepositorySpy: sinon.SinonSpiedInstance<HbarSpendingPlanRepository>;
    let evmAddressHbarSpendingPlanRepositorySpy: sinon.SinonSpiedInstance<EvmAddressHbarSpendingPlanRepository>;
    let ipAddressHbarSpendingPlanRepositorySpy: sinon.SinonSpiedInstance<IPAddressHbarSpendingPlanRepository>;

    overrideEnvsInMochaDescribe({
      HBAR_SPENDING_PLANS_CONFIG: hbarSpendingPlansConfigEnv,
      CACHE_TTL: 100,
      CACHE_MAX: spendingPlansConfig.length,
    });

    before(async function () {
      const reservedKeys = HbarSpendingPlanConfigService.getPreconfiguredSpendingPlanKeys(logger);
      // @ts-ignore
      CacheService.instances = [];
      cacheService = CacheService.getInstance(CACHE_LEVEL.L1, registry, reservedKeys);
      hbarSpendingPlanRepository = new HbarSpendingPlanRepository(
        cacheService,
        logger.child({ name: 'hbar-spending-plan-repository' }),
      );
      evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(
        cacheService,
        logger.child({ name: 'evm-address-spending-plan-repository' }),
      );
      ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(
        cacheService,
        logger.child({ name: 'ip-address-spending-plan-repository' }),
      );
      hbarSpendingPlanConfigService = new HbarSpendingPlanConfigService(
        logger,
        hbarSpendingPlanRepository,
        evmAddressHbarSpendingPlanRepository,
        ipAddressHbarSpendingPlanRepository,
      );
    });

    after(async function () {
      if (ConfigService.get('REDIS_ENABLED')) {
        await cacheService.disconnectRedisClient();
      }
    });

    beforeEach(async function () {
      loggerSpy = sinon.spy(logger);
      cacheServiceSpy = sinon.spy(cacheService);
      hbarSpendingPlanRepositorySpy = sinon.spy(hbarSpendingPlanRepository);
      evmAddressHbarSpendingPlanRepositorySpy = sinon.spy(evmAddressHbarSpendingPlanRepository);
      ipAddressHbarSpendingPlanRepositorySpy = sinon.spy(ipAddressHbarSpendingPlanRepository);
    });

    afterEach(async function () {
      sinon.restore();
      await cacheService.clear(emptyRequestDetails);
    });

    describe('populatePreconfiguredSpendingPlans', function () {
      describe('negative scenarios', function () {
        it('should not throw an error if the configuration file is not found', async function () {
          sinon.stub(fs, 'existsSync').returns(false);
          await expect(hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans()).not.to.be.rejected;
        });

        withOverriddenEnvsInMochaTest(
          {
            HBAR_SPENDING_PLANS_CONFIG: spendingPlansConfigFile,
          },
          () => {
            it('should throw an error if configuration file is not a parsable JSON', async function () {
              sinon.stub(fs, 'readFileSync').returns('invalid JSON');
              await expect(
                hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans(),
              ).to.be.eventually.rejectedWith(`Unexpected token 'i', "invalid JSON" is not valid JSON`);
            });
          },
        );

        it('should throw an error if the configuration file has entry without ID', async function () {
          const invalidPlan = {
            name: 'Plan without ID',
            subscriptionTier: SubscriptionTier.EXTENDED,
            evmAddresses: ['0x123'],
          };
          sinon
            .stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any)
            .returns([...spendingPlansConfig, invalidPlan]);

          await expect(
            hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans(),
          ).to.be.eventually.rejectedWith(`Invalid spending plan configuration: ${JSON.stringify(invalidPlan)}`);
        });

        it('should throw an error if the configuration file has entry without name', async function () {
          const invalidPlan = {
            id: 'plan-without-name',
            subscriptionTier: SubscriptionTier.EXTENDED,
            evmAddresses: ['0x123'],
          };
          sinon
            .stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any)
            .returns([...spendingPlansConfig, invalidPlan]);

          await expect(
            hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans(),
          ).to.be.eventually.rejectedWith(`Invalid spending plan configuration: ${JSON.stringify(invalidPlan)}`);
        });

        it('should throw an error if the configuration file has entry without subscriptionTier', async function () {
          const invalidPlan = {
            id: 'plan-without-tier',
            name: 'Plan without tier',
            evmAddresses: ['0x123'],
          };
          sinon
            .stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any)
            .returns([...spendingPlansConfig, invalidPlan]);

          await expect(
            hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans(),
          ).to.be.eventually.rejectedWith(`Invalid spending plan configuration: ${JSON.stringify(invalidPlan)}`);
        });

        it('should throw an error if the configuration file has entry with invalid subscriptionTier', async function () {
          const invalidPlan = {
            id: 'plan-invalid-tier',
            name: 'Plan with invalid tier',
            subscriptionTier: 'INVALID_TIER',
            evmAddresses: ['0x123'],
          };
          sinon
            .stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any)
            .returns([...spendingPlansConfig, invalidPlan]);

          await expect(
            hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans(),
          ).to.be.eventually.rejectedWith(`Invalid spending plan configuration: ${JSON.stringify(invalidPlan)}`);
        });

        it('should throw an error if the configuration file has entry without evmAddresses and ipAddresses', async function () {
          const invalidPlan = {
            id: 'plan-without-addresses',
            name: 'Plan without addresses',
            subscriptionTier: SubscriptionTier.EXTENDED,
          };
          sinon
            .stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any)
            .returns([...spendingPlansConfig, invalidPlan]);

          await expect(
            hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans(),
          ).to.be.eventually.rejectedWith(`Invalid spending plan configuration: ${JSON.stringify(invalidPlan)}`);
        });

        it('should throw an error if the configuration file has entry with empty evmAddresses and ipAddresses', async function () {
          const invalidPlan = {
            id: 'plan-with-empty-addresses',
            name: 'Plan with empty addresses',
            subscriptionTier: SubscriptionTier.EXTENDED,
            evmAddresses: [],
            ipAddresses: [],
          };
          sinon
            .stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any)
            .returns([...spendingPlansConfig, invalidPlan]);

          await expect(
            hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans(),
          ).to.be.eventually.rejectedWith(`Invalid spending plan configuration: ${JSON.stringify(invalidPlan)}`);
        });
      });

      describe('positive scenarios', function () {
        // Helper function to save spending plans and their associations from the configurations
        const saveSpendingPlans = async (spendingPlansConfig: SpendingPlanConfig[]) => {
          for (const plan of spendingPlansConfig) {
            await hbarSpendingPlanRepository.create(
              plan.subscriptionTier,
              emptyRequestDetails,
              neverExpireTtl,
              plan.id,
            );
            for (const evmAddress of plan.evmAddresses || []) {
              await evmAddressHbarSpendingPlanRepository.save(
                { evmAddress, planId: plan.id },
                emptyRequestDetails,
                neverExpireTtl,
              );
            }
            for (const ipAddress of plan.ipAddresses || []) {
              await ipAddressHbarSpendingPlanRepository.save(
                { ipAddress, planId: plan.id },
                emptyRequestDetails,
                neverExpireTtl,
              );
            }
          }
          hbarSpendingPlanRepositorySpy.create.resetHistory();
          evmAddressHbarSpendingPlanRepositorySpy.save.resetHistory();
          ipAddressHbarSpendingPlanRepositorySpy.save.resetHistory();
        };

        // Helper to find obsolete associations (deleted or associated with a different plan in the new config file)
        const findObsoleteAssociations = (
          oldConfig: SpendingPlanConfig[],
          newConfig: SpendingPlanConfig[],
          fieldName: 'evmAddresses' | 'ipAddresses',
        ) => {
          const obsoleteAssociations: { address: string; oldPlanId: string; newPlanId?: string }[] = [];

          oldConfig.forEach((oldPlan) => {
            oldPlan[fieldName]?.forEach((address) => {
              const newPlan = newConfig.find((plan) => plan[fieldName]?.includes(address));
              if (!newPlan || newPlan.id !== oldPlan.id) {
                obsoleteAssociations.push({ address, oldPlanId: oldPlan.id, newPlanId: newPlan?.id });
              }
            });
          });

          newConfig.forEach((newPlan) => {
            newPlan[fieldName]?.forEach((address) => {
              const oldPlan = oldConfig.find((oldPlan) => oldPlan[fieldName]?.includes(address));
              if (oldPlan) {
                obsoleteAssociations.push({ address, oldPlanId: oldPlan.id, newPlanId: newPlan.id });
              }
            });
          });

          return obsoleteAssociations;
        };

        // Helper function to verify spending plans based on the changes in configuration file
        const verifySpendingPlans = async (oldConfig: SpendingPlanConfig[], newConfig?: SpendingPlanConfig[]) => {
          const spendingPlans = newConfig || oldConfig;

          // Validate existence of the configured spending plans and their associations to eth and ip addresses
          for (const plan of spendingPlans) {
            await verifyResult(() => hbarSpendingPlanRepository.findById(plan.id, emptyRequestDetails), {
              id: plan.id,
              subscriptionTier: plan.subscriptionTier,
              active: true,
            });

            for (const evmAddress of plan.evmAddresses || []) {
              await verifyResult(
                () => evmAddressHbarSpendingPlanRepository.findByAddress(evmAddress, emptyRequestDetails),
                { evmAddress, planId: plan.id },
              );
            }

            for (const ipAddress of plan.ipAddresses || []) {
              await verifyResult(
                () => ipAddressHbarSpendingPlanRepository.findByAddress(ipAddress, emptyRequestDetails),
                { ipAddress, planId: plan.id },
              );
            }
          }

          // If the config has been changed, check for deleted plans and associations which are no longer valid
          if (newConfig) {
            const obsoletePlans = oldConfig.filter((oldPlan) => !newConfig.some((plan) => plan.id === oldPlan.id));
            const obsoleteEthAssociations = findObsoleteAssociations(oldConfig, newConfig, 'evmAddresses');
            const obsoleteIpAssociations = findObsoleteAssociations(oldConfig, newConfig, 'ipAddresses');

            // Validate non-existence of obsolete plans
            for (const plan of obsoletePlans) {
              await verifyResult(
                () => hbarSpendingPlanRepository.findById(plan.id, emptyRequestDetails),
                null,
                `HbarSpendingPlan with ID ${plan.id} not found`,
                HbarSpendingPlanNotFoundError,
              );
            }

            // Validate non-existence of obsolete EVM address associations
            for (const { address, newPlanId } of obsoleteEthAssociations) {
              await verifyResult(
                () => evmAddressHbarSpendingPlanRepository.findByAddress(address, emptyRequestDetails),
                newPlanId ? { evmAddress: address, planId: newPlanId } : null,
                `EvmAddressHbarSpendingPlan with address ${address} not found`,
                EvmAddressHbarSpendingPlanNotFoundError,
              );
            }

            // Validate non-existence of obsolete IP address associations
            for (const { address, newPlanId } of obsoleteIpAssociations) {
              await verifyResult(
                () => ipAddressHbarSpendingPlanRepository.findByAddress(address, emptyRequestDetails),
                newPlanId ? { ipAddress: address, planId: newPlanId } : null,
                `IPAddressHbarSpendingPlan not found`,
                IPAddressHbarSpendingPlanNotFoundError,
              );
            }
          }
        };

        it('should populate the database with pre-configured spending plans', async function () {
          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          spendingPlansConfig.forEach(({ id, name, subscriptionTier }) => {
            sinon.assert.calledWith(
              hbarSpendingPlanRepositorySpy.create,
              subscriptionTier,
              emptyRequestDetails,
              neverExpireTtl,
              id,
            );
            sinon.assert.calledWith(
              loggerSpy.info,
              `Created HBAR spending plan "${name}" with ID "${id}" and subscriptionTier "${subscriptionTier}"`,
            );
          });

          await verifySpendingPlans(spendingPlansConfig);
        });

        it('should not delete pre-configured spending plans after default cache TTL expires', async function () {
          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          await new Promise((resolve) => setTimeout(resolve, ConfigService.get('CACHE_TTL')));

          await verifySpendingPlans(spendingPlansConfig);
        });

        it('should remove associations of addresses which were previously linked to BASIC spending plans, but now appear in the configuration file', async function () {
          const basicPlans = spendingPlansConfig.map((plan, index) => ({
            ...plan,
            id: `basic-plan-${index}`,
            subscriptionTier: SubscriptionTier.BASIC,
          }));
          await saveSpendingPlans(basicPlans);

          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          spendingPlansConfig.forEach(({ id, evmAddresses, ipAddresses }) => {
            if (evmAddresses) {
              evmAddresses.forEach((evmAddress) => {
                sinon.assert.calledWith(
                  evmAddressHbarSpendingPlanRepositorySpy.save,
                  { evmAddress, planId: id },
                  emptyRequestDetails,
                  neverExpireTtl,
                );
                sinon.assert.calledWith(
                  evmAddressHbarSpendingPlanRepositorySpy.delete,
                  evmAddress,
                  emptyRequestDetails,
                );
              });
            }

            if (ipAddresses) {
              ipAddresses.forEach((ipAddress) => {
                sinon.assert.calledWith(
                  ipAddressHbarSpendingPlanRepositorySpy.save,
                  { ipAddress, planId: id },
                  emptyRequestDetails,
                  neverExpireTtl,
                );
                sinon.assert.calledWith(ipAddressHbarSpendingPlanRepositorySpy.delete, ipAddress, emptyRequestDetails);
              });
            }
          });

          await verifySpendingPlans(spendingPlansConfig);
        });

        it('should delete obsolete EXTENDED and PRIVILEGED plans from the database', async function () {
          const obsoletePlans: SpendingPlanConfig[] = [
            {
              id: 'plan-basic',
              name: 'Basic Plan',
              subscriptionTier: SubscriptionTier.BASIC,
              evmAddresses: ['0x122'],
              ipAddresses: ['126.0.0.1'],
            },
            {
              id: 'plan-extended',
              name: 'Extended Plan',
              subscriptionTier: SubscriptionTier.EXTENDED,
              evmAddresses: ['0x123'],
              ipAddresses: ['127.0.0.1'],
            },
            {
              id: 'plan-privileged',
              name: 'Privileged Plan',
              subscriptionTier: SubscriptionTier.PRIVILEGED,
              evmAddresses: ['0x124'],
              ipAddresses: ['128.0.0.1'],
            },
          ];
          await saveSpendingPlans(obsoletePlans);

          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          expect(hbarSpendingPlanRepositorySpy.delete.calledTwice).to.be.true;
          for (const { id, subscriptionTier, evmAddresses, ipAddresses } of obsoletePlans) {
            if (subscriptionTier === SubscriptionTier.BASIC) {
              sinon.assert.neverCalledWith(hbarSpendingPlanRepositorySpy.delete, id, emptyRequestDetails);
              continue;
            }
            sinon.assert.calledWith(hbarSpendingPlanRepositorySpy.delete, id, emptyRequestDetails);
            sinon.assert.calledWith(
              loggerSpy.info,
              `Deleting HBAR spending plan with ID "${id}", as it is no longer in the spending plan configuration...`,
            );
            sinon.assert.calledWithMatch(evmAddressHbarSpendingPlanRepositorySpy.deleteAllByPlanId, id);
            sinon.assert.calledWithMatch(ipAddressHbarSpendingPlanRepositorySpy.deleteAllByPlanId, id);
            evmAddresses?.forEach((evmAddress) => {
              const key = evmAddressHbarSpendingPlanRepository['getKey'](evmAddress);
              sinon.assert.calledWithMatch(cacheServiceSpy.delete, key);
            });
            ipAddresses?.forEach((ipAddress) => {
              const key = ipAddressHbarSpendingPlanRepository['getKey'](ipAddress);
              sinon.assert.calledWithMatch(cacheServiceSpy.delete, key);
            });
          }

          await verifySpendingPlans(spendingPlansConfig);
        });

        it('should not duplicate already existing spending plans and their associations', async function () {
          await saveSpendingPlans(spendingPlansConfig);

          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          sinon.assert.notCalled(hbarSpendingPlanRepositorySpy.create);
          sinon.assert.notCalled(evmAddressHbarSpendingPlanRepositorySpy.save);
          sinon.assert.notCalled(ipAddressHbarSpendingPlanRepositorySpy.save);

          await verifySpendingPlans(spendingPlansConfig);
        });

        it('should save only new associations for EVM addresses', async function () {
          const newSpendingPlansConfig = spendingPlansConfig.map((plan, index) => ({
            id: plan.id,
            name: plan.name,
            subscriptionTier: plan.subscriptionTier,
            evmAddresses: [toHex(index)].concat(plan.evmAddresses ? plan.evmAddresses : []),
            ipAddresses: plan.ipAddresses,
          }));
          sinon.stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any).returns(newSpendingPlansConfig);
          await saveSpendingPlans(spendingPlansConfig);

          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          spendingPlansConfig.forEach((config, index) => {
            sinon.assert.calledWith(
              evmAddressHbarSpendingPlanRepositorySpy.save,
              { evmAddress: toHex(index), planId: config.id },
              emptyRequestDetails,
              neverExpireTtl,
            );
            if (config.evmAddresses) {
              config.evmAddresses.forEach((evmAddress) => {
                sinon.assert.neverCalledWith(
                  evmAddressHbarSpendingPlanRepositorySpy.save,
                  { evmAddress, planId: config.id },
                  emptyRequestDetails,
                  neverExpireTtl,
                );
                sinon.assert.neverCalledWith(
                  evmAddressHbarSpendingPlanRepositorySpy.delete,
                  evmAddress,
                  emptyRequestDetails,
                );
              });
            }
          });

          await verifySpendingPlans(spendingPlansConfig, newSpendingPlansConfig);
        });

        it('should save only new associations for IP addresses', async function () {
          const newSpendingPlansConfig = spendingPlansConfig.map((plan, index) => ({
            id: plan.id,
            name: plan.name,
            subscriptionTier: plan.subscriptionTier,
            evmAddresses: plan.evmAddresses,
            ipAddresses: [`255.0.0.${index}`].concat(plan.ipAddresses ? plan.ipAddresses : []),
          }));
          sinon.stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any).returns(newSpendingPlansConfig);
          await saveSpendingPlans(spendingPlansConfig);

          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          spendingPlansConfig.forEach((config, index) => {
            sinon.assert.calledWith(ipAddressHbarSpendingPlanRepositorySpy.save, {
              ipAddress: `255.0.0.${index}`,
              planId: config.id,
            });
            if (config.ipAddresses) {
              config.ipAddresses.forEach((ipAddress) => {
                sinon.assert.neverCalledWith(ipAddressHbarSpendingPlanRepositorySpy.save, {
                  ipAddress,
                  planId: config.id,
                });
                sinon.assert.neverCalledWith(
                  ipAddressHbarSpendingPlanRepositorySpy.delete,
                  ipAddress,
                  emptyRequestDetails,
                );
              });
            }
          });

          await verifySpendingPlans(spendingPlansConfig, newSpendingPlansConfig);
        });

        it('should delete obsolete associations for EVM addresses', async function () {
          const newSpendingPlansConfig = spendingPlansConfig.map((plan) => ({
            id: plan.id,
            name: plan.name,
            subscriptionTier: plan.subscriptionTier,
            evmAddresses: plan.evmAddresses ? [plan.evmAddresses[0]] : [],
            ipAddresses: plan.ipAddresses,
          }));
          sinon.stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any).returns(newSpendingPlansConfig);
          await saveSpendingPlans(spendingPlansConfig);

          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          spendingPlansConfig.forEach(({ id, evmAddresses }) => {
            if (evmAddresses) {
              evmAddresses.forEach((evmAddress, index) => {
                sinon.assert.neverCalledWith(evmAddressHbarSpendingPlanRepositorySpy.save, {
                  evmAddress,
                  planId: id,
                });
                if (index === 0) {
                  sinon.assert.neverCalledWith(
                    evmAddressHbarSpendingPlanRepositorySpy.delete,
                    evmAddress,
                    emptyRequestDetails,
                  );
                } else {
                  sinon.assert.calledWith(
                    evmAddressHbarSpendingPlanRepositorySpy.delete,
                    evmAddress,
                    emptyRequestDetails,
                  );
                }
              });
            }
          });

          await verifySpendingPlans(spendingPlansConfig, newSpendingPlansConfig);
        });

        it('should delete obsolete associations for IP addresses', async function () {
          const newSpendingPlansConfig = spendingPlansConfig.map((plan) => ({
            id: plan.id,
            name: plan.name,
            subscriptionTier: plan.subscriptionTier,
            evmAddresses: plan.evmAddresses,
            ipAddresses: plan.ipAddresses ? [plan.ipAddresses[0]] : [],
          }));
          sinon.stub(HbarSpendingPlanConfigService, 'loadSpendingPlansConfig' as any).returns(newSpendingPlansConfig);
          await saveSpendingPlans(spendingPlansConfig);

          await hbarSpendingPlanConfigService.populatePreconfiguredSpendingPlans();

          spendingPlansConfig.forEach(({ id, ipAddresses }) => {
            if (ipAddresses) {
              ipAddresses.forEach((ipAddress, index) => {
                sinon.assert.neverCalledWith(ipAddressHbarSpendingPlanRepositorySpy.save, {
                  ipAddress,
                  planId: id,
                });
                if (index === 0) {
                  sinon.assert.neverCalledWith(
                    ipAddressHbarSpendingPlanRepositorySpy.delete,
                    ipAddress,
                    emptyRequestDetails,
                  );
                } else {
                  sinon.assert.calledWith(
                    ipAddressHbarSpendingPlanRepositorySpy.delete,
                    ipAddress,
                    emptyRequestDetails,
                  );
                }
              });
            }
          });

          await verifySpendingPlans(spendingPlansConfig, newSpendingPlansConfig);
        });
      });
    });
  };

  describe('using Redis cache', function () {
    useInMemoryRedisServer(logger, 6384);

    describe('and with a spending plan config file', function () {
      tests(spendingPlansConfigFile);
    });

    describe('and with a spending plan config variable', function () {
      tests(JSON.stringify(spendingPlansConfig));
    });
  });

  describe('using LRU cache', function () {
    overrideEnvsInMochaDescribe({ REDIS_ENABLED: false });

    describe('and with a spending plan config file', function () {
      tests(spendingPlansConfigFile);
    });

    describe('and with a spending plan config variable', function () {
      tests(JSON.stringify(spendingPlansConfig));
    });
  });
});
