// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import pino from 'pino';
import { register, Registry } from 'prom-client';

import { SDKClient } from '../../src/lib/clients';
import constants from '../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { CacheService } from '../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../src/lib/services/hbarLimitService';
import { RequestDetails } from '../../src/lib/types';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../helpers';

const registry = new Registry();
const logger = pino({ level: 'silent' });

// @ts-expect-error: Interface 'HAPIServiceTest' incorrectly extends interface 'HAPIService'.
interface HAPIServiceTest extends HAPIService {
  getSDKClient(): HAPIService['getSDKClient'];
  transactionCount: HAPIService['transactionCount'];
  resetDuration: HAPIService['resetDuration'];
  errorCodes: HAPIService['errorCodes'];
  isReinitEnabled: HAPIService['isReinitEnabled'];
}

describe('HAPI Service', async function () {
  this.timeout(20000);
  let cacheService: CacheService;
  let hbarLimitService: HbarLimitService;

  const errorStatus = 50;
  const requestDetails = new RequestDetails({ requestId: 'hapiService.spec.ts', ipAddress: '0.0.0.0' });

  this.beforeAll(() => {
    const duration = constants.HBAR_RATE_LIMIT_DURATION;
    cacheService = new CacheService(logger, registry);

    const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(cacheService, logger);
    const evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(cacheService, logger);
    const ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(cacheService, logger);
    hbarLimitService = new HbarLimitService(
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
      logger,
      register,
      duration,
    );
  });

  overrideEnvsInMochaDescribe({
    HAPI_CLIENT_TRANSACTION_RESET: 0,
    HAPI_CLIENT_DURATION_RESET: 0,
    HAPI_CLIENT_ERROR_RESET: [50],
  });

  it('should be able to initialize SDK instance', async function () {
    const hapiService = new HAPIService(logger, registry, hbarLimitService) as unknown as HAPIServiceTest;
    const sdkClient = hapiService.getSDKClient();

    expect(sdkClient).to.be.instanceof(SDKClient);
  });

  withOverriddenEnvsInMochaTest({ HAPI_CLIENT_TRANSACTION_RESET: 2 }, () => {
    it('should be able to reinitialise SDK instance upon reaching transaction limit', async function () {
      const hapiClientTransactionReset = Number(ConfigService.get('HAPI_CLIENT_TRANSACTION_RESET'));

      const hapiService = new HAPIService(logger, registry, hbarLimitService) as unknown as HAPIServiceTest;
      expect(hapiService.transactionCount).to.eq(hapiClientTransactionReset);

      hapiService.getSDKClient(); // decrease transaction limit by taking the instance
      const oldSDKInstance = hapiService.getSDKClient(); // decrease transaction limit by taking the instance
      expect(hapiService.transactionCount).to.eq(0);
      const newSDKInstance = hapiService.getSDKClient();

      expect(oldSDKInstance).to.not.be.equal(newSDKInstance);
      expect(hapiService.transactionCount).to.eq(hapiClientTransactionReset - 1); // one less because we took the instance once and decreased the counter
    });
  });

  withOverriddenEnvsInMochaTest({ HAPI_CLIENT_DURATION_RESET: 100 }, () => {
    it('should be able to reinitialise SDK instance upon reaching time limit', async function () {
      const hapiClientDurationReset = Number(ConfigService.get('HAPI_CLIENT_DURATION_RESET'));

      const hapiService = new HAPIService(logger, registry, hbarLimitService) as unknown as HAPIServiceTest;
      expect(hapiService.resetDuration - Date.now()).to.be.approximately(hapiClientDurationReset, 10); // 10 ms tolerance

      await new Promise((r) => setTimeout(r, 200)); // await to reach time limit
      const oldSDKInstance = hapiService.getSDKClient();
      const newSDKInstance = hapiService.getSDKClient();

      expect(hapiService.resetDuration - Date.now()).to.be.approximately(hapiClientDurationReset, 10); // 10 ms tolerance
      expect(oldSDKInstance).to.not.be.equal(newSDKInstance);
    });
  });

  withOverriddenEnvsInMochaTest({ HAPI_CLIENT_ERROR_RESET: [50] }, () => {
    it('should be able to reinitialise SDK instance upon error status code encounter', async function () {
      const hapiClientErrorReset = ConfigService.get('HAPI_CLIENT_ERROR_RESET');

      const hapiService = new HAPIService(logger, registry, hbarLimitService) as unknown as HAPIServiceTest;
      expect(hapiService.errorCodes[0]).to.eq(hapiClientErrorReset[0]);

      const oldSDKInstance = hapiService.getSDKClient();
      hapiService.decrementErrorCounter(errorStatus);
      const newSDKInstance = hapiService.getSDKClient();

      expect(oldSDKInstance).to.not.be.equal(newSDKInstance);
      expect(hapiService.errorCodes[0]).to.eq(hapiClientErrorReset[0]);
    });
  });

  withOverriddenEnvsInMochaTest(
    {
      HAPI_CLIENT_ERROR_RESET: [50],
      HAPI_CLIENT_TRANSACTION_RESET: 50,
      HAPI_CLIENT_DURATION_RESET: 36000,
    },
    () => {
      it('should be able to reset all counter upon reinitialization of the SDK Client', async function () {
        const hapiClientTransactionReset = Number(ConfigService.get('HAPI_CLIENT_TRANSACTION_RESET'));
        const hapiClientDurationReset = Number(ConfigService.get('HAPI_CLIENT_DURATION_RESET'));

        const hapiService = new HAPIService(logger, registry, hbarLimitService) as unknown as HAPIServiceTest;

        const oldSDKInstance = hapiService.getSDKClient();
        hapiService.decrementErrorCounter(errorStatus);
        const newSDKInstance = hapiService.getSDKClient();

        expect(hapiService.resetDuration - Date.now()).to.be.approximately(hapiClientDurationReset, 10); // 10 ms tolerance
        expect(hapiService.transactionCount).to.eq(hapiClientTransactionReset - 1); // one less because we took the instance once and decreased the counter
        expect(oldSDKInstance).to.not.be.equal(newSDKInstance);
      });
    },
  );

  withOverriddenEnvsInMochaTest(
    {
      HAPI_CLIENT_ERROR_RESET: [50],
      HAPI_CLIENT_TRANSACTION_RESET: 50,
      HAPI_CLIENT_DURATION_RESET: 36000,
    },
    () => {
      it('should keep the same instance of hbar limiter and not reset the budget', async function () {
        const costAmount = 10000;
        const hapiService = new HAPIService(logger, registry, hbarLimitService) as unknown as HAPIServiceTest;

        const hbarLimiterBudgetBefore = await hbarLimitService['getRemainingBudget'](requestDetails);
        const oldSDKInstance = hapiService.getSDKClient();

        await hbarLimitService.addExpense(costAmount, '', requestDetails);
        hapiService.decrementErrorCounter(errorStatus);

        const newSDKInstance = hapiService.getSDKClient();
        const hbarLimiterBudgetAfter = await hbarLimitService['getRemainingBudget'](requestDetails);

        expect(hbarLimiterBudgetBefore.toTinybars().toNumber()).to.be.greaterThan(
          hbarLimiterBudgetAfter.toTinybars().toNumber(),
        );
        expect(oldSDKInstance).to.not.be.equal(newSDKInstance);
      });
    },
  );

  withOverriddenEnvsInMochaTest(
    {
      HAPI_CLIENT_TRANSACTION_RESET: 0,
      HAPI_CLIENT_DURATION_RESET: 0,
      HAPI_CLIENT_ERROR_RESET: [],
    },
    () => {
      it('should not be able to reinitialise and decrement counters, if it is disabled', async function () {
        const hapiService = new HAPIService(logger, registry, hbarLimitService) as unknown as HAPIServiceTest;
        expect(hapiService.transactionCount).to.eq(Number(ConfigService.get('HAPI_CLIENT_TRANSACTION_RESET')));

        const oldSDKInstance = hapiService.getSDKClient();
        const newSDKInstance = hapiService.getSDKClient();

        expect(oldSDKInstance).to.be.equal(newSDKInstance);
        expect(hapiService.isReinitEnabled).to.be.equal(false);
      });
    },
  );
});
