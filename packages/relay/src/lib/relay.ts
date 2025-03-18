// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Client } from '@hashgraph/sdk';
import EventEmitter from 'events';
import { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';

import type { Debug, Eth, Net, Subs, Web3 } from '../index';
import { Utils } from '../utils';
import { MirrorNodeClient } from './clients';
import { HbarSpendingPlanConfigService } from './config/hbarSpendingPlanConfigService';
import constants from './constants';
import { EvmAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from './db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { DebugImpl } from './debug';
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

export class RelayImpl {
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
   * The Debug Service implementation that takes care of all filter API operations.
   */
  private readonly debugImpl: DebugImpl;

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

  readonly methods: { [methodName: string]: { func: any; obj: any } };

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

    this.web3Impl = new Web3Impl();
    this.netImpl = new NetImpl();

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

    this.ethImpl = new EthImpl(
      hapiService,
      this.mirrorNodeClient,
      logger.child({ name: 'relay-eth' }),
      chainId,
      register,
      this.cacheService,
    );

    this.debugImpl = new DebugImpl(this.mirrorNodeClient, logger, (this.ethImpl as EthImpl).common);

    this.methods = Object.fromEntries(
      ['debug', 'net', 'web3'].flatMap((namespace) => {
        const obj = this[namespace]();
        const descriptors = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(obj));
        return Object.entries(descriptors)
          .filter(([, descriptor]) => 'rpc' in descriptor.value)
          .map(([methodName, descriptor]) => [
            `${namespace}_${methodName}`,
            {
              func: descriptor.value,
              obj,
            },
          ]);
      }),
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
          const operatorAccountId = clientMain.operatorAccountId!.toString();
          const account = await mirrorNodeClient.getAccount(
            operatorAccountId,
            new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' }),
          );

          const accountBalance = account.balance?.balance;

          // Note: In some cases, the account balance returned from the Mirror Node is of type BigNumber.
          // However, the Prometheus client’s set() method only accepts standard JavaScript numbers.
          const numericBalance =
            typeof accountBalance === 'object' && accountBalance.toNumber
              ? accountBalance.toNumber()
              : Number(accountBalance);

          this.labels({ accountId: operatorAccountId }).set(numericBalance);
        } catch (e: any) {
          logger.error(e, `Error collecting operator balance. Skipping balance set`);
        }
      },
    });
  }

  debug(): Debug {
    return this.debugImpl;
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

  dispatch(methodName: string, args: unknown[] | undefined, requestDetails: RequestDetails) {
    const method = this.methods[methodName];
    // if (method === undefined) {
    //   throw new JsonRpcError("Method not found", -32601);
    // }
    const { func, obj } = method;
    // const params = func.params;

    // Validator.validateParams(args, params);

    return func.call(obj, ...(args ?? []), requestDetails);
  }
}
