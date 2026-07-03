// SPDX-License-Identifier: Apache-2.0

import pino, { type Logger } from 'pino';
import { Registry } from 'prom-client';

import { ConfigService } from '../../../../config-service/services';
import { type ICacheClient } from '../../clients/cache/ICacheClient';
import { MirrorNodeClient } from '../../clients/mirrorNodeClient';
import { CacheClientFactory } from '../../factories/cacheClientFactory';
import { RegistryFactory } from '../../factories/registryFactory';
import { AccountService } from '../ethService/accountService/AccountService';
import { CommonService } from '../ethService/ethCommonService/CommonService';
import { LocalPendingTransactionStorage } from '../transactionPoolService/LocalPendingTransactionStorage';
import { TransactionPoolService } from '../transactionPoolService/transactionPoolService';

/**
 * Clients and services shared by every worker task within one execution context.
 */
export interface WorkerContext {
  logger: Logger;
  cacheService: ICacheClient;
  mirrorNodeClient: MirrorNodeClient;
  commonService: CommonService;
  accountService: AccountService;
}

/** Created once per thread and shared by every context on that thread. */
const logger: Logger = pino({ level: ConfigService.get('LOG_LEVEL') || 'trace' });

/**
 * Single per-thread cache for the worker context.
 */
let cachedContext: WorkerContext | null = null;

/**
 * Creates a {@link WorkerContext}. Each argument is reused if supplied and instantiated otherwise, so
 * callers pass whatever they want to share (e.g. the relay's client in local mode); with no client, a
 * self-contained context is built around a fresh one.
 *
 * @param mirrorNodeClient - Existing client to reuse; omit on a worker thread to create one.
 * @param cacheService - Existing cache to reuse; omit on a worker thread to create one.
 * @param commonService - Existing common service to reuse; instantiated if omitted.
 * @param transactionPoolService - Existing transaction pool service to reuse; instantiated if omitted.
 * @param accountService - Existing account service to reuse; instantiated if omitted.
 * @returns A fully wired {@link WorkerContext}.
 */
export function createWorkerContext(
  mirrorNodeClient?: MirrorNodeClient,
  cacheService?: ICacheClient,
  commonService?: CommonService,
  transactionPoolService?: TransactionPoolService,
  accountService?: AccountService,
): WorkerContext {
  const register = RegistryFactory.getInstance();
  if (!cacheService) {
    cacheService = CacheClientFactory.create(logger, register);
  }
  if (!mirrorNodeClient) {
    mirrorNodeClient = new MirrorNodeClient(ConfigService.get('MIRROR_NODE_URL'), logger, register, cacheService);
  }
  if (!commonService) {
    commonService = new CommonService(mirrorNodeClient, logger, cacheService);
  }
  if (!transactionPoolService) {
    // Can use LocalPendingTransactionStorage() as transactionPoolService is required in AccountService constructor but not used for getBalance.
    // Passing a new Registry() instead of the global `register` from above because this dummy's constructor removes+re-registers txpool metrics — on the main thread (local mode) that would clobber the relay's live metrics on the shared registry.
    transactionPoolService = new TransactionPoolService(new LocalPendingTransactionStorage(), logger, new Registry());
  }
  if (!accountService) {
    accountService = new AccountService(cacheService, commonService, logger, mirrorNodeClient, transactionPoolService);
  }

  return { logger, cacheService, mirrorNodeClient, commonService, accountService };
}

/**
 * Returns the thread's cached {@link WorkerContext}, building it once via {@link createWorkerContext} on first
 * use. All arguments are forwarded to the builder on that first call and ignored thereafter.
 *
 * @param mirrorNodeClient - Existing client to reuse; omit on a worker thread to create one.
 * @param cacheService - Existing cache to reuse; omit on a worker thread to create one.
 * @param commonService - Existing common service to reuse; instantiated if omitted.
 * @param transactionPoolService - Existing transaction pool service to reuse; instantiated if omitted.
 * @param accountService - Existing account service to reuse; instantiated if omitted.
 * @returns A fully wired {@link WorkerContext}.
 */
export function getWorkerContext(
  mirrorNodeClient?: MirrorNodeClient,
  cacheService?: ICacheClient,
  commonService?: CommonService,
  transactionPoolService?: TransactionPoolService,
  accountService?: AccountService,
): WorkerContext {
  if (!cachedContext) {
    cachedContext = createWorkerContext(
      mirrorNodeClient,
      cacheService,
      commonService,
      transactionPoolService,
      accountService,
    );
  }
  return cachedContext;
}

/** Clears the cached context so the next {@link getWorkerContext} call rebuilds it. */
export function resetWorkerContext(): void {
  cachedContext = null;
}
