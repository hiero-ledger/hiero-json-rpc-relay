// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import EventEmitter from 'events';
import { Logger } from 'pino';
import { Histogram, Registry } from 'prom-client';

import { MirrorNodeClient, SDKClient } from '../../clients';
import constants from '../../constants';
import {
  IExecuteQueryEventPayload,
  IExecuteTransactionEventPayload,
  ITransactionRecordMetric,
  RequestDetails,
} from '../../types';
import { HbarLimitService } from '../hbarLimitService';

export default class MetricService {
  /**
   * Logger instance for logging information.
   * @type {Logger}
   * @readonly
   * @private
   */
  private readonly logger: Logger;

  /**
   * Main SDK client for executing queries.
   * @type {SDKClient}
   * @readonly
   * @private
   */
  private readonly sdkClient: SDKClient;

  /**
   * Main Mirror Node client for retrieving transaction records.
   * @type {MirrorNodeClient}
   * @readonly
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * Histogram for capturing the cost of transactions and queries.
   * @type {Histogram}
   * @readonly
   * @private
   */
  private readonly consensusNodeClientHistogramCost: Histogram;

  /**
   * Histogram for capturing the gas fee of transactions and queries.
   * @type {Histogram}
   * @readonly
   * @private
   */
  private readonly consensusNodeClientHistogramGasFee: Histogram;

  /**
   * An instance of EventEmitter used for emitting and handling events within the class.
   *
   * @private
   * @readonly
   * @type {EventEmitter}
   */
  private readonly eventEmitter: EventEmitter;

  /**
   * An instance of the HbarLimitService that tracks hbar expenses and limits.
   * @private
   * @readonly
   * @type {HbarLimitService}
   */
  private readonly hbarLimitService: HbarLimitService;

  /**
   * Constructs an instance of the MetricService responsible for tracking and recording various metrics
   * related to Hedera network interactions and resource usage.
   *
   * @param {Logger} logger - Logger instance for logging system messages.
   * @param {SDKClient} sdkClient - Client for interacting with the Hedera SDK.
   * @param {MirrorNodeClient} mirrorNodeClient - Client for querying the Hedera mirror node.
   * @param {Registry} register - Registry instance for registering metrics.
   * @param {EventEmitter} eventEmitter - The eventEmitter used for emitting and handling events within the class.
   */
  constructor(
    logger: Logger,
    sdkClient: SDKClient,
    mirrorNodeClient: MirrorNodeClient,
    register: Registry,
    eventEmitter: EventEmitter,
    hbarLimitService: HbarLimitService,
  ) {
    this.logger = logger;
    this.sdkClient = sdkClient;
    this.eventEmitter = eventEmitter;
    this.mirrorNodeClient = mirrorNodeClient;
    this.hbarLimitService = hbarLimitService;
    this.consensusNodeClientHistogramCost = this.initCostMetric(register);
    this.consensusNodeClientHistogramGasFee = this.initGasMetric(register);

    this.eventEmitter.on(constants.EVENTS.EXECUTE_TRANSACTION, (args: IExecuteTransactionEventPayload) => {
      this.captureTransactionMetrics(args).then();
    });

    this.eventEmitter.on(constants.EVENTS.EXECUTE_QUERY, (args: IExecuteQueryEventPayload) => {
      this.addExpenseAndCaptureMetrics(args);
    });
  }

  /**
   * Captures and logs transaction metrics by retrieving transaction records from the appropriate source
   * and recording the transaction fees, gas usage, and other relevant metrics.
   *
   * @param {IExecuteTransactionEventPayload} payload - The payload object containing transaction details.
   * @param {string} payload.callerName - The name of the entity calling the transaction.
   * @param {string} payload.transactionId - The unique identifier for the transaction.
   * @param {string} payload.txConstructorName - The name of the transaction constructor.
   * @param {string} payload.operatorAccountId - The account ID of the operator managing the transaction.
   * @param {string} payload.interactingEntity - The entity interacting with the transaction.
   * @param {RequestDetails} payload.requestDetails - The request details for logging and tracking.
   * @param {string} payload.originalCallerAddress - The address of the original caller making the request.
   * @returns {Promise<void>} - A promise that resolves when the transaction metrics have been captured.
   */
  public async captureTransactionMetrics({
    callerName,
    transactionId,
    txConstructorName,
    operatorAccountId,
    interactingEntity,
    requestDetails,
    originalCallerAddress,
  }: IExecuteTransactionEventPayload): Promise<void> {
    const transactionRecordMetrics = await this.getTransactionRecordMetrics(
      transactionId,
      callerName,
      txConstructorName,
      operatorAccountId,
      requestDetails,
    );

    if (transactionRecordMetrics) {
      const { gasUsed, transactionFee, txRecordChargeAmount, status } = transactionRecordMetrics;
      if (transactionFee !== 0) {
        await this.addExpenseAndCaptureMetrics({
          executionMode: constants.EXECUTION_MODE.TRANSACTION,
          transactionId,
          txConstructorName,
          callerName,
          cost: transactionFee,
          gasUsed,
          interactingEntity,
          status,
          requestDetails,
          originalCallerAddress,
        } as IExecuteQueryEventPayload);
      }

      if (txRecordChargeAmount !== 0) {
        await this.addExpenseAndCaptureMetrics({
          executionMode: constants.EXECUTION_MODE.RECORD,
          transactionId,
          txConstructorName,
          callerName,
          cost: txRecordChargeAmount,
          gasUsed: 0,
          interactingEntity,
          status,
          requestDetails,
          originalCallerAddress,
        } as IExecuteQueryEventPayload);
      }
    }
  }

  /**
   * Adds the expense to the HBAR rate limiter and captures the relevant metrics for the executed transaction.
   *
   * @param {IExecuteQueryEventPayload} payload - The payload object containing details about the transaction.
   * @param {string} payload.executionMode - The mode of the execution (TRANSACTION, QUERY, RECORD).
   * @param {string} payload.transactionId - The unique identifier for the transaction.
   * @param {string} payload.txConstructorName - The name of the transaction constructor.
   * @param {string} payload.callerName - The name of the entity calling the transaction.
   * @param {number} payload.cost - The cost of the transaction in tinybars.
   * @param {number} payload.gasUsed - The amount of gas used during the transaction.
   * @param {string} payload.interactingEntity - The entity interacting with the transaction.
   * @param {string} payload.status - The entity interacting with the transaction.
   * @param {string} payload.requestDetails - The request details for logging and tracking.
   * @param {string | undefined} payload.originalCallerAddress - The address of the original caller making the request.
   * @returns {void} - This method does not return a value.
   */
  public addExpenseAndCaptureMetrics = async ({
    executionMode,
    transactionId,
    txConstructorName,
    callerName,
    cost,
    gasUsed,
    interactingEntity,
    status,
    requestDetails,
    originalCallerAddress,
  }: IExecuteQueryEventPayload): Promise<void> => {
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${requestDetails.formattedRequestId} Capturing transaction fee charged to operator: executionMode=${executionMode} transactionId=${transactionId}, txConstructorName=${txConstructorName}, callerName=${callerName}, cost=${cost} tinybars`,
      );
    }

    await this.hbarLimitService.addExpense(cost, originalCallerAddress ?? '', requestDetails);
    this.captureMetrics(executionMode, txConstructorName, status, cost, gasUsed, callerName, interactingEntity);
  };

  /**
   * Initialize consensus node cost metrics
   * @param {Registry} register
   * @returns {Histogram} Consensus node cost metric
   */
  private initCostMetric(register: Registry): Histogram {
    const metricHistogramCost = 'rpc_relay_consensusnode_response';
    register.removeSingleMetric(metricHistogramCost);
    return new Histogram({
      name: metricHistogramCost,
      help: 'Relay consensusnode mode type status cost histogram',
      labelNames: ['mode', 'type', 'status', 'caller', 'interactingEntity'],
      registers: [register],
    });
  }

  /**
   * Initialize consensus node gas metrics
   * @param {Registry} register
   * @returns {Histogram} Consensus node gas metric
   */
  private initGasMetric(register: Registry): Histogram {
    const metricHistogramGasFee = 'rpc_relay_consensusnode_gasfee';
    register.removeSingleMetric(metricHistogramGasFee);
    return new Histogram({
      name: metricHistogramGasFee,
      help: 'Relay consensusnode mode type status gas fee histogram',
      labelNames: ['mode', 'type', 'status', 'caller', 'interactingEntity'],
      registers: [register],
    });
  }

  /**
   * Captures and records metrics for a transaction.
   * @private
   * @param {string} mode - The mode of the transaction (e.g., consensus mode).
   * @param {string} type - The type of the transaction.
   * @param {string} status - The status of the transaction.
   * @param {number} cost - The cost of the transaction in tinybars.
   * @param {number} gas - The gas used by the transaction.
   * @param {string} caller - The name of the caller executing the transaction.
   * @param {string} interactingEntity - The entity interacting with the transaction.
   * @returns {void}
   */
  private captureMetrics = (
    mode: string,
    type: string,
    status: string,
    cost: number,
    gas: number,
    caller: string,
    interactingEntity: string,
  ): void => {
    this.consensusNodeClientHistogramCost.labels(mode, type, status, caller, interactingEntity).observe(cost);
    this.consensusNodeClientHistogramGasFee.labels(mode, type, status, caller, interactingEntity).observe(gas);
  };

  /**
   * Retrieves transaction record metrics based on the transaction ID.
   * Depending on the environment configuration, the metrics are fetched either from the
   * consensus node via the SDK client or from the mirror node.
   *
   * @param {string} transactionId - The ID of the transaction for which metrics are being retrieved.
   * @param {string} callerName - The name of the caller requesting the metrics.
   * @param {string} txConstructorName - The name of the transaction constructor.
   * @param {string} operatorAccountId - The account ID of the operator.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<ITransactionRecordMetric | undefined>} - The transaction record metrics or undefined if retrieval fails.
   */
  private async getTransactionRecordMetrics(
    transactionId: string,
    callerName: string,
    txConstructorName: string,
    operatorAccountId: string,
    requestDetails: RequestDetails,
  ): Promise<ITransactionRecordMetric | undefined> {
    const defaultToConsensusNode = ConfigService.get('GET_RECORD_DEFAULT_TO_CONSENSUS_NODE');

    // retrieve transaction metrics
    try {
      if (defaultToConsensusNode) {
        return await this.sdkClient.getTransactionRecordMetrics(
          transactionId,
          callerName,
          txConstructorName,
          operatorAccountId,
          requestDetails,
        );
      } else {
        return await this.mirrorNodeClient.getTransactionRecordMetrics(
          transactionId,
          callerName,
          txConstructorName,
          operatorAccountId,
          requestDetails,
        );
      }
    } catch (error: any) {
      this.logger.warn(
        error,
        `${requestDetails.formattedRequestId} Could not fetch transaction record: error=${error.message}`,
      );
    }
  }
}
