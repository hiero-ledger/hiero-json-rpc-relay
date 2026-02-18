// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { AccountId } from '@hashgraph/sdk';
import { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';
import { RedisClientType } from 'redis';

import { Admin, Eth, Net, TxPool, Web3 } from '../index';
import { Utils } from '../utils';
import { AdminImpl } from './admin';
import { MirrorNodeClient } from './clients';
import type { ICacheClient } from './clients/cache/ICacheClient';
import { RedisClientManager } from './clients/redisClientManager';
import { HbarSpendingPlanConfigService } from './config/hbarSpendingPlanConfigService';
import constants from './constants';
import { EvmAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from './db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from './db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { DebugImpl } from './debug';
import { RpcMethodDispatcher } from './dispatcher';
import { EthImpl } from './eth';
import { CacheClientFactory } from './factories/cacheClientFactory';
import { NetImpl } from './net';
import { LockService, LockStrategyFactory, TransactionPoolService } from './services';
import HAPIService from './services/hapiService/hapiService';
import { HbarLimitService } from './services/hbarLimitService';
import MetricService from './services/metricService/metricService';
import { registerRpcMethods } from './services/registryService/rpcMethodRegistryService';
import { PendingTransactionStorageFactory } from './services/transactionPoolService/PendingTransactionStorageFactory';
import { TxPoolImpl } from './txpool';
import {
  IEthExecutionEventPayload,
  IExecuteQueryEventPayload,
  IExecuteTransactionEventPayload,
  RequestDetails,
  RpcMethodRegistry,
  RpcNamespaceRegistry,
} from './types';
import { Web3Impl } from './web3';

export class Relay {
  /**
   * The primary Hedera client used for interacting with the Hedera network.
   */
  private operatorAccountId!: AccountId | null;

  /**
   * @private
   * @readonly
   * @property {MirrorNodeClient} mirrorNodeClient - The client used to interact with the Hedera Mirror Node for retrieving historical data.
   */
  private mirrorNodeClient!: MirrorNodeClient;

  /**
   * @private
   * @readonly
   * @property {Web3} web3Impl - The Web3 implementation used for Ethereum-compatible interactions.
   */
  private web3Impl!: Web3;

  /**
   * @private
   * @readonly
   * @property {Net} netImpl - The Net implementation used for handling network-related Ethereum JSON-RPC requests.
   */
  private netImpl!: Net;

  /**
   * @private
   * @readonly
   * @property {Admin} adminImpl - The Hedera implementation used for handling network-related Ethereum JSON-RPC requests.
   */
  private adminImpl!: Admin;

  /**
   * @private
   * @readonly
   * @property {Eth} ethImpl - The Eth implementation used for handling Ethereum-specific JSON-RPC requests.
   */
  private ethImpl!: Eth;

  /**
   * @private
   * @readonly
   * @property {TxPool} txpoolImpl - The TxPool implementation used for handling Ethereum-specific JSON-RPC requests.
   */
  private txpoolImpl!: TxPool;

  /**
   * @private
   * @readonly
   * @property {ICacheClient} cacheService - The service responsible for caching data to improve performance.
   */
  private cacheService!: ICacheClient;

  /**
   * @private
   * @readonly
   * @property {HbarSpendingPlanConfigService} hbarSpendingPlanConfigService - The service responsible for managing HBAR spending plans.
   */
  private hbarSpendingPlanConfigService!: HbarSpendingPlanConfigService;

  /**
   * @private
   * @readonly
   * @property {MetricService} metricService - The service responsible for capturing and reporting metrics.
   */
  private metricService!: MetricService;

  /**
   * The Debug Service implementation that takes care of all filter API operations.
   */
  private debugImpl!: DebugImpl;

  /**
   * Registry for RPC methods that manages the mapping between RPC method names and their implementations.
   * This registry is populated with methods from various service implementations (eth, net, web3, debug)
   * that have been decorated with the @rpcMethod decorator.
   *
   * @public
   * @type {Map<string, Function>} - The registry containing all available RPC methods.
   */
  public rpcMethodRegistry!: RpcMethodRegistry;

  /**
   * The RPC method dispatcher that takes care of executing the correct method based on the request.
   */
  private rpcMethodDispatcher!: RpcMethodDispatcher;

  /**
   * The Redis client we use for connecting to Redis
   */
  private redisClient: RedisClientType | undefined;

  /**
   * Private constructor to prevent direct instantiation.
   * Use Relay.init() static factory method instead.
   *
   * @param {Logger} logger - Logger instance for logging system messages.
   * @param {Registry} register - Registry instance for registering metrics.
   */
  private constructor(
    private readonly logger: Logger,
    private readonly register: Registry,
  ) {
    logger.info('Configurations successfully loaded');
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
          this.logger.info(`Pre-configured spending plans populated successfully`);
        }
      })
      .catch((e) => this.logger.warn(`Failed to load pre-configured spending plans: %s`, e.message));
  }

  /**
   * Initialize operator account metrics
   * @param operatorAccountId
   * @param mirrorNodeClient
   * @param logger
   * @param register
   * @returns Operator Metric
   */
  private initOperatorMetric(
    operatorAccountId: AccountId | null,
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
          const accountId = operatorAccountId!.toString();
          const account = await mirrorNodeClient.getAccount(
            accountId,
            new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' }),
          );

          const accountBalance = account.balance?.balance;

          // Note: In some cases, the account balance returned from the Mirror Node is of type BigNumber.
          // However, the Prometheus client’s set() method only accepts standard JavaScript numbers.
          const numericBalance =
            typeof accountBalance === 'object' && accountBalance.toNumber
              ? accountBalance.toNumber()
              : Number(accountBalance);

          this.labels({ accountId }).set(numericBalance);
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

  txpool(): TxPool {
    return this.txpoolImpl;
  }

  mirrorClient(): MirrorNodeClient {
    return this.mirrorNodeClient;
  }

  /**
   * Initializes required clients and services
   */
  async initializeRelay() {
    // 1. Connect to Redis first
    await this.connectRedisClient();

    // 2. Initialize all services with the connected Redis client
    this.initializeServices();

    // 3. Validate operator balance (requires ethImpl to be initialized)
    if (!ConfigService.get('READ_ONLY')) {
      await this.ensureOperatorHasBalance();
    }
  }

  /**
   * Initializes all services after infrastructure (Redis) is ready.
   * This method is called from initializeRelay() after Redis connection is established.
   *
   * @private
   */
  private initializeServices(): void {
    const chainId = ConfigService.get('CHAIN_ID');
    const duration = constants.HBAR_RATE_LIMIT_DURATION;
    const reservedKeys = HbarSpendingPlanConfigService.getPreconfiguredSpendingPlanKeys(this.logger);

    // Create CacheService with the connected Redis client (or undefined for LRU-only)
    this.cacheService = CacheClientFactory.create(
      this.logger.child({ name: 'cache-service' }),
      this.register,
      reservedKeys,
      this.redisClient,
    );

    // Create spending plan repositories
    const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(
      this.cacheService,
      this.logger.child({ name: 'hbar-spending-plan-repository' }),
    );
    const evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(
      this.cacheService,
      this.logger.child({ name: 'evm-address-spending-plan-repository' }),
    );
    const ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(
      this.cacheService,
      this.logger.child({ name: 'ip-address-spending-plan-repository' }),
    );

    // Create HBAR limit service
    const hbarLimitService = new HbarLimitService(
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
      this.logger.child({ name: 'hbar-rate-limit' }),
      this.register,
      duration,
    );

    const lockService = new LockService(LockStrategyFactory.create(this.redisClient, this.logger, this.register));
    const hapiService = new HAPIService(this.logger, this.register, hbarLimitService);
    this.operatorAccountId = hapiService.getOperatorAccountId();

    // Create simple service implementations
    this.web3Impl = new Web3Impl();
    this.netImpl = new NetImpl();

    // Create Mirror Node client
    this.mirrorNodeClient = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      this.logger.child({ name: `mirror-node` }),
      this.register,
      this.cacheService,
      undefined,
      ConfigService.get('MIRROR_NODE_URL_WEB3') || ConfigService.get('MIRROR_NODE_URL'),
    );

    // Create Metric service
    const metricsCollector = ConfigService.get('GET_RECORD_DEFAULT_TO_CONSENSUS_NODE')
      ? hapiService
      : this.mirrorNodeClient;
    this.metricService = new MetricService(this.logger, metricsCollector, this.register, hbarLimitService);

    const storage = PendingTransactionStorageFactory.create(this.redisClient);
    const transactionPoolService = new TransactionPoolService(
      storage,
      this.logger.child({ name: 'transaction-pool-service' }),
      this.register,
    );

    // Create Eth implementation with connected Redis client
    this.ethImpl = new EthImpl(
      hapiService,
      this.mirrorNodeClient,
      this.logger.child({ name: 'relay-eth' }),
      chainId,
      this.cacheService,
      transactionPoolService,
      lockService,
      this.register,
    );

    // Set up event listeners
    (this.ethImpl as EthImpl).eventEmitter.on('eth_execution', (args: IEthExecutionEventPayload) => {
      this.metricService.ethExecutionsCounter.labels(args.method).inc();
    });

    hapiService.eventEmitter.on('execute_transaction', (args: IExecuteTransactionEventPayload) => {
      this.metricService.captureTransactionMetrics(args).then();
    });

    hapiService.eventEmitter.on('execute_query', (args: IExecuteQueryEventPayload) => {
      this.metricService.addExpenseAndCaptureMetrics(args);
    });

    this.txpoolImpl = new TxPoolImpl(transactionPoolService);

    // Create Debug and Admin implementations
    this.debugImpl = new DebugImpl(this.mirrorNodeClient, this.logger, this.cacheService, chainId);
    this.adminImpl = new AdminImpl(this.cacheService);

    // Create HBAR spending plan config service
    this.hbarSpendingPlanConfigService = new HbarSpendingPlanConfigService(
      this.logger.child({ name: 'hbar-spending-plan-config-service' }),
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
    );

    // Initialize operator metric
    this.initOperatorMetric(this.operatorAccountId, this.mirrorNodeClient, this.logger, this.register);

    // Populate pre-configured spending plans asynchronously
    this.populatePreconfiguredSpendingPlans().then();

    // Create RPC method registry
    const rpcNamespaceRegistry = ['eth', 'net', 'web3', 'debug', 'txpool'].map((namespace) => ({
      namespace,
      serviceImpl: this[namespace](),
    }));

    this.rpcMethodRegistry = registerRpcMethods(rpcNamespaceRegistry as RpcNamespaceRegistry[]);

    // Initialize RPC method dispatcher
    this.rpcMethodDispatcher = new RpcMethodDispatcher(this.rpcMethodRegistry, this.logger, this.register);

    this.logger.info('Relay running with chainId=%s', chainId);
  }

  private async connectRedisClient() {
    if (RedisClientManager.isRedisEnabled()) {
      this.redisClient = await RedisClientManager.getClient(this.logger);
    } else {
      this.redisClient = undefined;
    }
  }

  private async ensureOperatorHasBalance() {
    const operator = this.operatorAccountId!.toString();
    const balance = BigInt(await this.ethImpl.getBalance(operator, 'latest', {} as RequestDetails));
    if (balance === BigInt(0)) {
      throw new Error(`Operator account '${operator}' has no balance`);
    } else {
      this.logger.info(`Operator account '%s' has balance: %s`, operator, balance);
    }
  }

  /**
   * Static factory method to create and initialize a Relay instance.
   * This is the recommended way to create a Relay instance as it ensures
   * all async initialization (Redis connection, services, operator balance check) is complete.
   *
   * @param {Logger} logger - Logger instance for logging system messages.
   * @param {Registry} register - Registry instance for registering metrics.
   * @returns {Promise<Relay>} A fully initialized Relay instance.
   *
   * @example
   * ```typescript
   * const relay = await Relay.init(logger, register);
   * ```
   */
  static async init(logger: Logger, register: Registry): Promise<Relay> {
    const relay = new Relay(logger, register);

    await relay.initializeRelay();

    return relay;
  }
}
