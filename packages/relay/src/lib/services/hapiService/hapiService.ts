// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { AccountId, FileId, PublicKey, TransactionResponse } from '@hashgraph/sdk';
import { EventEmitter } from 'events';
import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import { SDKClient } from '../../clients';
import { ITransactionRecordMetric, RequestDetails, TypedEvents } from '../../types';
import { HbarLimitService } from '../hbarLimitService';
import { RawTxSynchronizeService } from '../rawTxSynchronizeService/RawTxSynchronizeService';

export default class HAPIService {
  /**
   * The number of transactions that have occurred.
   */
  private transactionCount: number;

  /**
   * An array of error codes encountered.
   */
  private readonly errorCodes: number[];

  /**
   * The duration for resetting operations.
   */
  private resetDuration: number;

  /**
   * Indicates whether a reset operation should occur.
   */
  private shouldReset: boolean;

  /**
   * Indicates whether reinitialization is enabled.
   */
  private readonly isReinitEnabled: boolean;

  /**
   * Indicates whether time-based resets are disabled.
   */
  private readonly isTimeResetDisabled: boolean;

  /**
   * The initial count of transactions.
   */
  private readonly initialTransactionCount: number;

  /**
   * The initial array of error codes.
   */
  private readonly initialErrorCodes: number[];

  /**
   * The initial duration for resetting operations.
   */
  private readonly initialResetDuration: number;

  /**
   * The network name for Hedera services.
   */
  private readonly hederaNetwork: string;

  /**
   * The SDK Client used for connecting to both the consensus nodes and mirror node. The account
   * associated with this client will pay for all operations on the main network.
   */
  private client: SDKClient;

  /**
   * The logger used for logging all output from this class.
   */
  private readonly logger: Logger;

  /**
   * An instance of the HbarLimitService that tracks hbar expenses and limits.
   */
  private readonly hbarLimitService: HbarLimitService;

  /**
   * An instance of EventEmitter used for emitting and handling events within the class.
   */
  readonly eventEmitter: EventEmitter<TypedEvents>;

  /**
   * A counter for tracking client resets.
   */
  private readonly clientResetCounter: Counter;

  /**
   * Constructs an instance of the class, initializes configuration settings, and sets up various services.
   *
   * @param logger - The logger instance used for logging.
   * @param register - The registry instance for metrics and other services.
   * @param hbarLimitService - An HBAR Rate Limit service that tracks hbar expenses and limits.
   */
  constructor(logger: Logger, register: Registry, hbarLimitService: HbarLimitService) {
    this.logger = logger;
    this.hbarLimitService = hbarLimitService;
    this.eventEmitter = new EventEmitter<TypedEvents>();
    this.hederaNetwork = ConfigService.get('HEDERA_NETWORK').toLowerCase();

    this.client = this.initSDKClient();

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

    const metricCounterName = 'rpc_relay_client_service';
    register.removeSingleMetric(metricCounterName);
    this.clientResetCounter = new Counter({
      name: metricCounterName,
      help: 'Relay Client Service',
      registers: [register],
      labelNames: ['transactions', 'errors'],
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
    this.clientResetCounter.labels(this.transactionCount.toString(), this.errorCodes.toString()).inc(1);

    this.client = this.initSDKClient();

    // Reset all counters with predefined configuration.
    this.transactionCount = this.initialTransactionCount;
    this.resetDuration = Date.now() + this.initialResetDuration;
    this.shouldReset = false;
  }

  /**
   * Configure SDK Client from main client
   * @returns SDK Client
   */
  private initSDKClient(): SDKClient {
    return new SDKClient(
      this.hederaNetwork,
      this.logger.child({ name: `consensus-node` }),
      this.eventEmitter,
      this.hbarLimitService,
    );
  }

  /**
   * Returns the operator account ID.
   *
   * @returns The operator account ID or `null` if not set.
   */
  public getOperatorAccountId(): AccountId | null {
    return this.client.getOperatorAccountId();
  }

  /**
   * Returns the public key of the operator account.
   *
   * @returns The operator's public key or `null` if not set.
   */
  public getOperatorPublicKey(): PublicKey | null {
    return this.client.getOperatorPublicKey();
  }

  /**
   * Return configured sdk client and reinitialize it before retuning, if needed.
   * @returns SDK Client
   */
  private getSDKClient(): SDKClient {
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
   * Wrapper around the SDK client's `submitEthereumTransaction` method.
   *
   * See {@link SDKClient.submitEthereumTransaction} for more details.
   */
  public async submitEthereumTransaction(
    transactionBuffer: Uint8Array,
    callerName: string,
    requestDetails: RequestDetails,
    originalCallerAddress: string,
    networkGasPriceInWeiBars: number,
    currentNetworkExchangeRateInCents: number,
    rawTxSynchronizeService: RawTxSynchronizeService,
    lockSessionKey: string | null,
  ): Promise<{ txResponse: TransactionResponse; fileId: FileId | null }> {
    return this.getSDKClient().submitEthereumTransaction(
      transactionBuffer,
      callerName,
      requestDetails,
      originalCallerAddress,
      networkGasPriceInWeiBars,
      currentNetworkExchangeRateInCents,
      rawTxSynchronizeService,
      lockSessionKey,
    );
  }

  /**
   * Wrapper around the SDK client's `deleteFile` method.
   *
   * See {@link SDKClient.deleteFile} for more details.
   */
  public async deleteFile(
    fileId: FileId,
    requestDetails: RequestDetails,
    callerName: string,
    originalCallerAddress: string,
  ): Promise<void> {
    return this.getSDKClient().deleteFile(fileId, requestDetails, callerName, originalCallerAddress);
  }

  /**
   * Wrapper around the SDK client's `getTransactionRecordMetrics` method.
   *
   * See {@link SDKClient.getTransactionRecordMetrics} for more details.
   */
  public async getTransactionRecordMetrics(
    transactionId: string,
    txConstructorName: string,
    operatorAccountId: string,
  ): Promise<ITransactionRecordMetric> {
    return this.getSDKClient().getTransactionRecordMetrics(transactionId, txConstructorName, operatorAccountId);
  }
}
