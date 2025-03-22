// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Client } from '@hashgraph/sdk';
import EventEmitter from 'events';
import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import { Utils } from '../../../utils';
import { SDKClient } from '../../clients';
import constants from '../../constants';
import { CacheService } from '../cacheService/cacheService';
import { HbarLimitService } from '../hbarLimitService';

export default class HAPIService {
  /**
   * The number of transactions that have occurred.
   * @private
   * @type {number}
   */
  private transactionCount: number;

  /**
   * An array of error codes encountered.
   * @private
   * @readonly
   * @type {number[]}
   */
  private readonly errorCodes: number[];

  /**
   * The duration for resetting operations.
   * @private
   * @type {number}
   */
  private resetDuration: number;

  /**
   * Indicates whether a reset operation should occur.
   * @private
   * @type {boolean}
   */
  private shouldReset: boolean;

  /**
   * Indicates whether reinitialization is enabled.
   * @private
   * @readonly
   * @type {boolean}
   */
  private readonly isReinitEnabled: boolean;

  /**
   * Indicates whether time-based resets are disabled.
   * @private
   * @readonly
   * @type {boolean}
   */
  private readonly isTimeResetDisabled: boolean;

  /**
   * The initial count of transactions.
   * @private
   * @readonly
   * @type {number}
   */
  private readonly initialTransactionCount: number;

  /**
   * The initial array of error codes.
   * @private
   * @readonly
   * @type {number[]}
   */
  private readonly initialErrorCodes: number[];

  /**
   * The initial duration for resetting operations.
   * @private
   * @readonly
   * @type {number}
   */
  private readonly initialResetDuration: number;

  /**
   * The network name for Hedera services.
   * @private
   * @readonly
   * @type {string}
   */
  private readonly hederaNetwork: string;

  /**
   * The main client for interacting with the Hedera network.
   * @private
   * @type {Client}
   */
  private clientMain: Client;

  /**
   * The SDK Client used for connecting to both the consensus nodes and mirror node. The account
   * associated with this client will pay for all operations on the main network.
   * @private
   * @type {SDKClient}
   */
  private client: SDKClient;

  /**
   * The logger used for logging all output from this class.
   * @private
   * @readonly
   * @type {Logger}
   */
  private readonly logger: Logger;

  /**
   * An instance of the HbarLimitService that tracks hbar expenses and limits.
   * @private
   * @readonly
   * @type {HbarLimitService}
   */
  private readonly hbarLimitService: HbarLimitService;
  /**
   * An instance of EventEmitter used for emitting and handling events within the class.
   * @private
   * @readonly
   * @type {EventEmitter}
   */
  private readonly eventEmitter: EventEmitter;

  /**
   * A registry used within the class.
   * @private
   * @readonly
   * @type {Registry}
   */
  private readonly register: Registry;

  /**
   * A counter for tracking client resets.
   * @private
   * @readonly
   * @type {Counter}
   */
  private readonly clientResetCounter: Counter;

  /**
   * A service for caching data within the class.
   * @private
   * @readonly
   * @type {CacheService}
   */
  private readonly cacheService: CacheService;

  /**
   * @private
   */
  private config: any;

  /**
   * Constructs an instance of the class, initializes configuration settings, and sets up various services.
   *
   * @param {Logger} logger - The logger instance used for logging.
   * @param {Registry} register - The registry instance for metrics and other services.
   * @param {CacheService} cacheService - The cache service instance.
   * @param {EventEmitter} eventEmitter - The event emitter instance used for emitting events.
   * @param {HbarLimitService} hbarLimitService - An HBAR Rate Limit service that tracks hbar expenses and limits.
   */
  constructor(
    logger: Logger,
    register: Registry,
    cacheService: CacheService,
    eventEmitter: EventEmitter,
    hbarLimitService: HbarLimitService,
  ) {
    this.logger = logger;
    this.hbarLimitService = hbarLimitService;
    this.eventEmitter = eventEmitter;
    this.hederaNetwork = ConfigService.get('HEDERA_NETWORK').toLowerCase();
    this.clientMain = this.initClient(logger, this.hederaNetwork);

    this.cacheService = cacheService;
    this.client = this.initSDKClient(logger);

    const currentDateNow = Date.now();
    this.initialTransactionCount = ConfigService.get('HAPI_CLIENT_TRANSACTION_RESET');
    this.initialResetDuration = ConfigService.get('HAPI_CLIENT_DURATION_RESET');
    this.initialErrorCodes = ConfigService.get('HAPI_CLIENT_ERROR_RESET');

    this.transactionCount = this.initialTransactionCount;
    this.resetDuration = currentDateNow + this.initialResetDuration;
    this.errorCodes = this.initialErrorCodes;

    this.isReinitEnabled = true;
    this.isTimeResetDisabled = this.resetDuration === currentDateNow;

    if (this.transactionCount === 0 && this.errorCodes.length === 0 && this.isTimeResetDisabled) {
      this.isReinitEnabled = false;
    }
    this.shouldReset = false;

    this.register = register;
    const metricCounterName = 'rpc_relay_client_service';
    this.register.removeSingleMetric(metricCounterName);
    this.clientResetCounter = new Counter({
      name: metricCounterName,
      help: 'Relay Client Service',
      registers: [register],
      labelNames: ['transactions', 'duration', 'errors'],
    });
  }

  /**
   *  Decrement transaction counter. If 0 is reached, reset the client. Check also if resetDuration has been reached and reset the client, if yes.
   */
  private decrementTransactionCounter() {
    if (this.transactionCount == 0) {
      return;
    }

    this.transactionCount--;
    if (this.transactionCount <= 0) {
      this.shouldReset = true;
    }
  }

  /**
   *  Decrement error encountered counter. If 0 is reached, reset the client. Check also if resetDuration has been reached and reset the client, if yes.
   */
  public decrementErrorCounter(statusCode: number) {
    if (!this.isReinitEnabled || this.errorCodes.length === 0) {
      return;
    }

    if (this.errorCodes.includes(statusCode)) {
      this.shouldReset = true;
    }
  }

  private checkResetDuration() {
    if (this.isTimeResetDisabled) {
      return;
    }

    if (this.resetDuration < Date.now()) {
      this.shouldReset = true;
    }
  }

  /**
   * Reset the SDK Client and all counters.
   */
  private resetClient() {
    this.clientResetCounter
      .labels(this.transactionCount.toString(), this.resetDuration.toString(), this.errorCodes.toString())
      .inc(1);

    this.clientMain = this.initClient(this.logger, this.hederaNetwork);
    this.client = this.initSDKClient(this.logger);
    this.resetCounters();
  }

  /**
   * Reset all counters with predefined configuration.
   */
  private resetCounters() {
    this.transactionCount = this.initialTransactionCount;
    this.resetDuration = Date.now() + this.initialResetDuration;

    this.shouldReset = false;
  }

  /**
   * Configure SDK Client from main client
   * @param {Logger} logger
   * @returns SDK Client
   */
  private initSDKClient(logger: Logger): SDKClient {
    return new SDKClient(
      this.clientMain,
      logger.child({ name: `consensus-node` }),
      this.cacheService,
      this.eventEmitter,
      this.hbarLimitService,
    );
  }

  /**
   * Configure Client
   * @param {Logger} logger
   * @param {string} hederaNetwork
   * @param {string | null} type
   * @returns Client
   */
  private initClient(logger: Logger, hederaNetwork: string, type: string | null = null): Client {
    let client: Client;
    if (hederaNetwork in constants.CHAIN_IDS) {
      client = Client.forName(hederaNetwork);
    } else {
      client = Client.forNetwork(JSON.parse(hederaNetwork));
    }

    const operator = Utils.getOperator(logger, type);
    if (operator) {
      client.setOperator(operator.accountId, operator.privateKey);
    }

    client.setTransportSecurity(ConfigService.get('CLIENT_TRANSPORT_SECURITY'));

    const SDK_REQUEST_TIMEOUT = ConfigService.get('SDK_REQUEST_TIMEOUT');
    client.setRequestTimeout(SDK_REQUEST_TIMEOUT);

    logger.info(
      `SDK client successfully configured to ${JSON.stringify(hederaNetwork)} for account ${
        client.operatorAccountId
      } with request timeout value: ${SDK_REQUEST_TIMEOUT}`,
    );

    return client;
  }

  /**
   * Return current main client instance
   * @returns Main Client
   */
  public getMainClientInstance() {
    return this.clientMain;
  }

  /**
   * Return configured sdk client and reinitialize it before retuning, if needed.
   * @returns SDK Client
   */
  public getSDKClient(): SDKClient {
    if (!this.isReinitEnabled) {
      return this.client;
    }

    if (this.shouldReset) {
      this.logger.warn(`SDK Client reinitialization.`);
      this.resetClient();
    }
    this.decrementTransactionCounter();
    this.checkResetDuration();

    return this.client;
  }

  /**
   * Return true if reinitialization feature is enabled.
   * @returns isEnabled boolean
   */
  public getIsReinitEnabled() {
    return this.isReinitEnabled;
  }

  /**
   * Return transaction count with current sdk instance.
   * @returns transactionCount
   */
  public getTransactionCount() {
    return this.transactionCount;
  }

  /**
   * Return error codes which can trigger a sdk instance reinitialization.
   * @returns errorCodes
   */
  public getErrorCodes() {
    return this.errorCodes;
  }

  /**
   * Return time until reset of the current sdk instance.
   */
  public getTimeUntilReset() {
    return this.resetDuration - Date.now();
  }
}
