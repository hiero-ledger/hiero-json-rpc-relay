// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Client } from '@hashgraph/sdk';
import EventEmitter from 'events';
import { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';

import { prepend0x } from '../formatters';
import { Eth, Net, Relay, Subs, Web3 } from '../index';
import { Utils } from '../utils';
import { MirrorNodeClient } from './clients';
import { HbarSpendingPlanConfigService } from './config/hbarSpendingPlanConfigService';
import constants from './constants';
import { EvmAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from './db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { RelayGlobalErrorHandler } from './errors/RelayGlobalErrorHandler';
import { EthImpl } from './eth';
import { NetImpl } from './net';
import { Poller } from './poller';
import { CacheService } from './services/cacheService/cacheService';
import HAPIService from './services/hapiService/hapiService';
import { HbarLimitService } from './services/hbarLimitService';
import MetricService from './services/metricService/metricService';
import { SubscriptionController } from './subscriptionController';
import { RequestDetails } from './types';
import { Web3Impl } from './web3';

export class RelayImpl implements Relay {
  /**
   * @private
   * @readonly
   * @property {Client} clientMain - The primary Hedera client used for interacting with the Hedera network.
   */
  private readonly clientMain: Client;

  /**
   * @private
   * @readonly
   * @property {MirrorNodeClient} mirrorNodeClient - The client used to interact with the Hedera Mirror Node for retrieving historical data.
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * @private
   * @readonly
   * @property {Web3} web3Impl - The Web3 implementation used for Ethereum-compatible interactions.
   */
  private readonly web3Impl: Web3;

  /**
   * @private
   * @readonly
   * @property {Net} netImpl - The Net implementation used for handling network-related Ethereum JSON-RPC requests.
   */
  private readonly netImpl: Net;

  /**
   * @private
   * @readonly
   * @property {Eth} ethImpl - The Eth implementation used for handling Ethereum-specific JSON-RPC requests.
   */
  private readonly ethImpl: Eth;

  /**
   * @private
   * @readonly
   * @property {Subs} [subImpl] - An optional implementation for handling subscription-related JSON-RPC requests.
   */
  private readonly subImpl?: Subs;

  /**
   * @private
   * @readonly
   * @property {CacheService} cacheService - The service responsible for caching data to improve performance.
   */
  private readonly cacheService: CacheService;

  /**
   * @private
   * @readonly
   * @property {HbarSpendingPlanConfigService} hbarSpendingPlanConfigService - The service responsible for managing HBAR spending plans.
   */
  private readonly hbarSpendingPlanConfigService: HbarSpendingPlanConfigService;

  /**
   * @private
   * @readonly
   * @property {MetricService} metricService - The service responsible for capturing and reporting metrics.
   */
  private readonly metricService: MetricService;

  /**
   * An instance of EventEmitter used for emitting and handling events within the class.
   *
   * @private
   * @readonly
   * @type {EventEmitter}
   */
  private readonly eventEmitter: EventEmitter;

  /**
   * An instance of RelayGlobalErrorHandler used for centralized error handling across the application.
   *
   * This handler maps domain-specific errors to standardized JsonRpcError objects and ensures
   * consistent logging and context for all errors that occur within the relay service.
   *
   * @private
   * @readonly
   * @type {RelayGlobalErrorHandler}
   */
  private readonly relayGlobalErrorHandler: RelayGlobalErrorHandler;

  /**
   * Initializes the main components of the relay service, including Hedera network clients,
   * Ethereum-compatible interfaces, caching, metrics, and subscription management.
   *
   * @param {Logger} logger - Logger instance for logging system messages.
   * @param {Registry} register - Registry instance for registering metrics.
   */
  constructor(
    private readonly logger: Logger,
    register: Registry,
  ) {
    logger.info('Configurations successfully loaded');

    // Initialize the RelayGlobalErrorHandler
    this.relayGlobalErrorHandler = new RelayGlobalErrorHandler(logger.child({ name: 'error-mapper-service' }));

    const chainId = ConfigService.get('CHAIN_ID');
    const duration = constants.HBAR_RATE_LIMIT_DURATION;

    this.eventEmitter = new EventEmitter();
    const reservedKeys = HbarSpendingPlanConfigService.getPreconfiguredSpendingPlanKeys(logger);
    this.cacheService = new CacheService(logger.child({ name: 'cache-service' }), register, reservedKeys);

    const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(
      this.cacheService,
      logger.child({ name: 'hbar-spending-plan-repository' }),
    );
    const evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(
      this.cacheService,
      logger.child({ name: 'evm-address-spending-plan-repository' }),
    );
    const ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(
      this.cacheService,
      logger.child({ name: 'ip-address-spending-plan-repository' }),
    );
    const hbarLimitService = new HbarLimitService(
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
      logger.child({ name: 'hbar-rate-limit' }),
      register,
      duration,
    );

    const hapiService = new HAPIService(logger, register, this.cacheService, this.eventEmitter, hbarLimitService);

    this.clientMain = hapiService.getMainClientInstance();

    this.web3Impl = this.wrapImplServiceWithErrorMapping(new Web3Impl(this.clientMain), Web3Impl.name);
    // this.web3Impl = new Web3Impl(this.clientMain);
    this.netImpl = this.wrapImplServiceWithErrorMapping(new NetImpl(this.clientMain), NetImpl.name);

    this.mirrorNodeClient = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: `mirror-node` }),
      register,
      this.cacheService,
      undefined,
      ConfigService.get('MIRROR_NODE_URL_WEB3') || ConfigService.get('MIRROR_NODE_URL'),
    );

    this.metricService = new MetricService(
      logger,
      hapiService.getSDKClient(),
      this.mirrorNodeClient,
      register,
      this.eventEmitter,
      hbarLimitService,
    );

    this.ethImpl = this.wrapImplServiceWithErrorMapping(
      new EthImpl(
        hapiService,
        this.mirrorNodeClient,
        logger.child({ name: 'relay-eth' }),
        chainId,
        register,
        this.cacheService,
      ),
      EthImpl.name,
    );

    this.hbarSpendingPlanConfigService = new HbarSpendingPlanConfigService(
      logger.child({ name: 'hbar-spending-plan-config-service' }),
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
    );

    if (ConfigService.get('SUBSCRIPTIONS_ENABLED')) {
      const poller = new Poller(this.ethImpl, logger.child({ name: `poller` }), register);
      this.subImpl = new SubscriptionController(poller, logger.child({ name: `subscr-ctrl` }), register);
    }

    this.initOperatorMetric(this.clientMain, this.mirrorNodeClient, logger, register);

    this.populatePreconfiguredSpendingPlans().then();

    logger.info('Relay running with chainId=%s', chainId);
  }

  /**
   * Creates a proxy around an implementation service class that serves as an error handling boundary.
   *
   * This method establishes a clear boundary layer for error handling at the interface between
   * packages. It uses JavaScript's Proxy to intercept all method calls on the implementation
   * service class, ensuring that:
   *
   * 1. All errors crossing package boundaries are properly transformed into JsonRpcError objects
   * 2. The original method's synchronous or asynchronous behavior is preserved
   * 3. Error handling is consistent across all service methods
   * 4. Implementation details of errors are abstracted away from dependent packages
   *
   * By applying this at package boundaries, we create a clean separation of concerns where
   * internal errors are properly mapped before propagating to external consumers.
   *
   * @param service - The service instance to wrap with error handling
   * @param serviceName - The name of the service (used for logging context)
   * @returns A proxied version of the service with error handling for all methods
   */
  private wrapImplServiceWithErrorMapping<T extends object>(service: T, serviceName: string): T {
    const handler = {
      get: (target: any, prop: string) => {
        const originalMethod = target[prop];

        // Only process actual methods (not constructor or properties)
        if (typeof originalMethod === 'function' && prop !== 'constructor') {
          // Determine if this is an async method by checking if it returns a Promise
          const isAsync =
            originalMethod.constructor.name === 'AsyncFunction' ||
            originalMethod.toString().includes('return __awaiter(') || // For transpiled async functions
            originalMethod.toString().includes('return new Promise'); // For explicit Promise returns

          return this.relayGlobalErrorHandler.createErrorHandlingProxy(
            originalMethod.bind(target),
            `${serviceName}.${prop}`,
            isAsync,
          );
        }

        // Return non-function properties as-is
        return originalMethod;
      },
    };

    // Return a proxy that wraps methods appropriately
    return new Proxy(service, handler) as T;
  }

  /**
   * Populates pre-configured spending plans from a configuration file.
   * @returns {Promise<void>} A promise that resolves when the spending plans have been successfully populated.
   */
  private async populatePreconfiguredSpendingPlans(): Promise<void> {
    return this.hbarSpendingPlanConfigService
      .populatePreconfiguredSpendingPlans()
      .then((plansUpdated) => {
        if (plansUpdated > 0) {
          this.logger.info('Pre-configured spending plans populated successfully');
        }
      })
      .catch((e) => this.logger.warn(`Failed to load pre-configured spending plans: ${e.message}`));
  }

  /**
   * Initialize operator account metrics
   * @param {Client} clientMain
   * @param {MirrorNodeClient} mirrorNodeClient
   * @param {Logger} logger
   * @param {Registry} register
   * @returns {Gauge} Operator Metric
   */
  private initOperatorMetric(
    clientMain: Client,
    mirrorNodeClient: MirrorNodeClient,
    logger: Logger,
    register: Registry,
  ): Gauge {
    const metricGaugeName = 'rpc_relay_operator_balance';
    register.removeSingleMetric(metricGaugeName);
    return new Gauge({
      name: metricGaugeName,
      help: 'Relay operator balance gauge',
      labelNames: ['mode', 'type', 'accountId'],
      registers: [register],
      async collect() {
        // Invoked when the registry collects its metrics' values.
        // Allows for updated account balance tracking
        try {
          const account = await mirrorNodeClient.getAccount(
            clientMain.operatorAccountId!.toString(),
            new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' }),
          );
          const accountBalance = account.balance?.balance;
          this.labels({ accountId: clientMain.operatorAccountId?.toString() }).set(accountBalance);
        } catch (e: any) {
          logger.error(e, `Error collecting operator balance. Skipping balance set`);
        }
      },
    });
  }

  web3(): Web3 {
    return this.web3Impl;
  }

  net(): Net {
    return this.netImpl;
  }

  eth(): Eth {
    return this.ethImpl;
  }

  subs(): Subs | undefined {
    return this.subImpl;
  }

  mirrorClient(): MirrorNodeClient {
    return this.mirrorNodeClient;
  }
}
