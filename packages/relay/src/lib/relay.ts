// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Client } from '@hashgraph/sdk';
import EventEmitter from 'events';
import { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';

import { Admin, Eth, Net, Subs, Web3 } from '../index';
import { Utils } from '../utils';
import { AdminImpl } from './admin';
import { MirrorNodeClient } from './clients';
import { HbarSpendingPlanConfigService } from './config/hbarSpendingPlanConfigService';
import constants from './constants';
import { EvmAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from './db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { DebugImpl } from './debug';
import { RpcMethodDispatcher } from './dispatcher';
import { EthImpl } from './eth';
import { NetImpl } from './net';
import { Poller } from './poller';
import { CacheService } from './services/cacheService/cacheService';
import HAPIService from './services/hapiService/hapiService';
import { HbarLimitService } from './services/hbarLimitService';
import MetricService from './services/metricService/metricService';
import { registerRpcMethods } from './services/registryService/rpcMethodRegistryService';
import { SubscriptionController } from './subscriptionController';
import { RequestDetails, RpcMethodRegistry, RpcNamespaceRegistry } from './types';
import { Web3Impl } from './web3';

export class Relay {
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
   * @property {Admin} adminImpl - The Hedera implementation used for handling network-related Ethereum JSON-RPC requests.
   */
  private readonly adminImpl: Admin;

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
   * The Debug Service implementation that takes care of all filter API operations.
   */
  private readonly debugImpl: DebugImpl;

  /**
   * Registry for RPC methods that manages the mapping between RPC method names and their implementations.
   * This registry is populated with methods from various service implementations (eth, net, web3, debug)
   * that have been decorated with the @rpcMethod decorator.
   *
   * @public
   * @type {Map<string, Function>} - The registry containing all available RPC methods.
   */
  public readonly rpcMethodRegistry: RpcMethodRegistry;

  /**
   * The RPC method dispatcher that takes care of executing the correct method based on the request.
   */
  private readonly rpcMethodDispatcher: RpcMethodDispatcher;

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

    this.debugImpl = new DebugImpl(this.mirrorNodeClient, logger, this.cacheService);
    this.adminImpl = new AdminImpl(this.cacheService);

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

    // Create a registry of all service implementations
    const rpcNamespaceRegistry = ['eth', 'net', 'web3', 'debug'].map((namespace) => ({
      namespace,
      serviceImpl: this[namespace](),
    }));

    // Registering RPC methods from the provided service implementations
    this.rpcMethodRegistry = registerRpcMethods(rpcNamespaceRegistry as RpcNamespaceRegistry[]);

    // Initialize the RPC method dispatcher
    this.rpcMethodDispatcher = new RpcMethodDispatcher(this.rpcMethodRegistry, this.logger);

    logger.info('Relay running with chainId=%s', chainId);
  }

  /**
   * Executes an RPC method by delegating to the RPC method dispatcher
   *
   * This method serves as the only public API entry point for server packages (i.e. HTTP and WebSocket)
   * to invoke RPC methods on the Relay.
   *
   * @param {string} rpcMethodName - The name of the RPC method to execute
   * @param {any[]} rpcMethodParams - The params for the RPC method to execute
   * @param {RequestDetails} requestDetails - Additional request context
   * @returns {Promise<any>} The result of executing the RPC method
   */
  public async executeRpcMethod(
    rpcMethodName: string,
    rpcMethodParams: any,
    requestDetails: RequestDetails,
  ): Promise<any> {
    return this.rpcMethodDispatcher.dispatch(rpcMethodName, rpcMethodParams, requestDetails);
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

  debug(): DebugImpl {
    return this.debugImpl;
  }

  web3(): Web3 {
    return this.web3Impl;
  }

  net(): Net {
    return this.netImpl;
  }

  admin(): Admin {
    return this.adminImpl;
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
