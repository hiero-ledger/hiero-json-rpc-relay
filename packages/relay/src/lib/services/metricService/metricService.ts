// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';
import { Counter, Histogram, Registry } from 'prom-client';

import constants from '../../constants';
import {
  IExecuteQueryEventPayload,
  IExecuteTransactionEventPayload,
  ITransactionRecordMetric,
  RequestDetails,
} from '../../types';
import { HbarLimitService } from '../hbarLimitService';

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
    this.consensusNodeClientHistogramCost = this.initCostMetric(register);
    this.consensusNodeClientHistogramGasFee = this.initGasMetric(register);
    this.ethExecutionsCounter = this.initEthCounter(register);
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
    this.logger.debug(
      'Capturing transaction fee charged to operator: executionMode=%s transactionId=%s, txConstructorName=%s, cost=%s tinybars',
      executionMode,
      transactionId,
      txConstructorName,
      cost,
    );

    await this.hbarLimitService.addExpense(cost, originalCallerAddress ?? '', requestDetails);
    this.captureMetrics(executionMode, txConstructorName, status, cost, gasUsed);
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
      labelNames: ['mode', 'type', 'status'],
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
      labelNames: ['mode', 'type', 'status'],
      registers: [register],
    });
  }

  private initEthCounter(register: Registry): Counter {
    const metricCounterName = 'rpc_relay_eth_executions';
    register.removeSingleMetric(metricCounterName);
    return new Counter({
      name: metricCounterName,
      help: `Relay ${metricCounterName} function`,
      labelNames: ['method'],
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
    } catch (error: any) {
      this.logger.warn(error, `Could not fetch transaction record: error=${error.message}`);
    }
  }
}
