// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import MockAdapter from 'axios-mock-adapter';
import pino from 'pino';
import { register, Registry } from 'prom-client';

import { ConfigServiceTestHelper } from '../../../../config-service/tests/configServiceTestHelper';
import { MirrorNodeClient } from '../../../src/lib/clients/mirrorNodeClient';
import constants from '../../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { EthImpl } from '../../../src/lib/eth';
import { CacheClientFactory } from '../../../src/lib/factories/cacheClientFactory';
import {
  CommonService,
  LocalPendingTransactionStorage,
  LockService,
  TransactionPoolService,
} from '../../../src/lib/services';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../../src/lib/services/hbarLimitService';

export function contractResultsByNumberByIndexURL(number: number, index: number): string {
  return `contracts/results?block.number=${number}&transaction.index=${index}&limit=100&order=asc`;
}

export function contractResultsByHashByIndexURL(hash: string, index: number): string {
  return `contracts/results?block.hash=${hash}&transaction.index=${index}&limit=100&order=asc`;
}

export function balancesByAccountIdByTimestampURL(id: string, timestamp?: string): string {
  const timestampQuery = timestamp ? `&timestamp=${timestamp}` : '';
  return `balances?account.id=${id}${timestampQuery}`;
}

export function generateEthTestEnv(fixedFeeHistory = false) {
  ConfigServiceTestHelper.dynamicOverride('ETH_FEE_HISTORY_FIXED', fixedFeeHistory);
  const logger = pino({ level: 'silent' });
  const registry = new Registry();
  const cacheService = CacheClientFactory.create(logger, registry);
  const mirrorNodeInstance = new MirrorNodeClient(
    ConfigService.get('MIRROR_NODE_URL'),
    logger.child({ name: `mirror-node` }),
    registry,
    cacheService,
  );

  const restMock = new MockAdapter(mirrorNodeInstance.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
  const web3Mock = new MockAdapter(mirrorNodeInstance.getMirrorNodeWeb3Instance(), { onNoMatch: 'throwException' });

  const duration = constants.HBAR_RATE_LIMIT_DURATION;

  const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(cacheService, logger);
  const evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(cacheService, logger);
  const ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(cacheService, logger);
  const hbarLimitService = new HbarLimitService(
    hbarSpendingPlanRepository,
    evmAddressHbarSpendingPlanRepository,
    ipAddressHbarSpendingPlanRepository,
    logger,
    register,
    duration,
  );

  const hapiServiceInstance = new HAPIService(logger, registry, hbarLimitService);

  const commonService = new CommonService(mirrorNodeInstance, logger, cacheService);

  const storage = new LocalPendingTransactionStorage();
  const lockService = new LockService({ acquireLock: async () => undefined, releaseLock: async () => {} } as any);
  const transactionPoolService = new TransactionPoolService(storage, logger, registry);
  const ethImpl = new EthImpl(
    hapiServiceInstance,
    mirrorNodeInstance,
    logger,
    '0x12a',
    cacheService,
    transactionPoolService,
    lockService,
    registry,
  );

  return {
    cacheService,
    mirrorNodeInstance,
    restMock,
    web3Mock,
    hapiServiceInstance,
    transactionPoolService,
    lockService,
    ethImpl,
    logger,
    registry,
    commonService,
  };
}
