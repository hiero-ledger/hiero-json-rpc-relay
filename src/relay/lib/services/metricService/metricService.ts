// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { type Counter, type Histogram, type Registry } from 'prom-client';

import { METRICS, MetricsFactory } from '../../../../metrics';
import constants from '../../constants';
import {
  type IExecuteQueryEventPayload,
  type IExecuteTransactionEventPayload,
  type ITransactionRecordMetric,
  type RequestDetails,
} from '../../types';
import { type HbarLimitService } from '../hbarLimitService';

interface ITransactionMetricsCollector {
  getTransactionRecordMetrics(
    transactionId: string,
    txConstructorName: string,
    operatorAccountId: string,
    requestDetails?: RequestDetails,
  ): Promise<ITransactionRecordMetric>;
}

export default class MetricService {
  /**
   * Logger instance for logging information.
   */
  private readonly logger: Logger;

  /**
   * Histogram for capturing the cost of transactions and queries.
   */
  private readonly consensusNodeClientHistogramCost: Histogram;

  /**
   * Histogram for capturing the gas fee of transactions and queries.
   */
  private readonly consensusNodeClientHistogramGasFee: Histogram;

  /**
   * Counter for tracking Ethereum executions.
   */
  readonly ethExecutionsCounter: Counter;

  /**
   * An instance of the HbarLimitService that tracks hbar expenses and limits.
   */
  private readonly hbarLimitService: HbarLimitService;

  /**
   * Constructs an instance of the MetricService responsible for tracking and recording various metrics
   * related to Hedera network interactions and resource usage.
   *
   * @param logger - Logger instance for logging system messages.
   * @param metricsCollector - `SDKClient` or `HAPIService` for fetching transaction record metrics from the Consensus Node.
   * @param register - Registry instance for registering metrics.
   * @param hbarLimitService - An instance of the HbarLimitService that tracks hbar expenses and limits.
   */
  constructor(
    logger: Logger,
    private readonly metricsCollector: ITransactionMetricsCollector,
    register: Registry,
    hbarLimitService: HbarLimitService,
  ) {
    this.logger = logger;
    this.hbarLimitService = hbarLimitService;

    const metricsFactory = new MetricsFactory(register);
    this.consensusNodeClientHistogramCost = metricsFactory.histogram(METRICS.consensusNode.responseCost);
    this.consensusNodeClientHistogramGasFee = metricsFactory.histogram(METRICS.consensusNode.gasFee);
    this.ethExecutionsCounter = metricsFactory.counter(METRICS.eth.executions);
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
    transactionId,
    txConstructorName,
    operatorAccountId,
    requestDetails,
    originalCallerAddress,
  }: IExecuteTransactionEventPayload): Promise<void> {
    const transactionRecordMetrics = await this.getTransactionRecordMetrics(
      transactionId,
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
          cost: transactionFee,
          gasUsed,
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
          cost: txRecordChargeAmount,
          gasUsed: 0,
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
   * @param {number} payload.cost - The cost of the transaction in tinybars.
   * @param {number} payload.gasUsed - The amount of gas used during the transaction.
   * @param {string} payload.status - The entity interacting with the transaction.
   * @param {string} payload.requestDetails - The request details for logging and tracking.
   * @param {string | undefined} payload.originalCallerAddress - The address of the original caller making the request.
   * @returns {void} - This method does not return a value.
   */
  public addExpenseAndCaptureMetrics = async ({
    executionMode,
    transactionId,
    txConstructorName,
    cost,
    gasUsed,
    status,
    requestDetails,
    originalCallerAddress,
  }: IExecuteQueryEventPayload): Promise<void> => {
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `Capturing transaction fee charged to operator: executionMode=${executionMode} transactionId=${transactionId}, txConstructorName=${txConstructorName}, cost=${cost} tinybars`,
      );
    }

    await this.hbarLimitService.addExpense(cost, originalCallerAddress ?? '', requestDetails);
    this.captureMetrics(executionMode, txConstructorName, status, cost, gasUsed);
  };

  /**
   * Captures and records metrics for a transaction.
   * @private
   * @param {string} mode - The mode of the transaction (e.g., consensus mode).
   * @param {string} type - The type of the transaction.
   * @param {string} status - The status of the transaction.
   * @param {number} cost - The cost of the transaction in tinybars.
   * @param {number} gas - The gas used by the transaction.
   * @returns {void}
   */
  private captureMetrics = (mode: string, type: string, status: string, cost: number, gas: number): void => {
    this.consensusNodeClientHistogramCost.labels(mode, type, status).observe(cost);
    this.consensusNodeClientHistogramGasFee.labels(mode, type, status).observe(gas);
  };

  /**
   * Retrieves transaction record metrics based on the transaction ID.
   * Depending on the environment configuration, the metrics are fetched either from the
   * consensus node via the SDK client or from the mirror node.
   *
   * @param {string} transactionId - The ID of the transaction for which metrics are being retrieved.
   * @param {string} txConstructorName - The name of the transaction constructor.
   * @param {string} operatorAccountId - The account ID of the operator.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<ITransactionRecordMetric | undefined>} - The transaction record metrics or undefined if retrieval fails.
   */
  private async getTransactionRecordMetrics(
    transactionId: string,
    txConstructorName: string,
    operatorAccountId: string,
    requestDetails: RequestDetails,
  ): Promise<ITransactionRecordMetric | undefined> {
    // retrieve transaction metrics
    try {
      return await this.metricsCollector.getTransactionRecordMetrics(
        transactionId,
        txConstructorName,
        operatorAccountId,
        requestDetails,
      );
    } catch (error) {
      this.logger.warn(error, `Could not fetch transaction record: error=${(error as Error).message}`);
    }
  }
}
