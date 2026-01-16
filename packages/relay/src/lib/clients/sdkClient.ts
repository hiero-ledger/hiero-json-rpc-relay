// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import {
  AccountId,
  Client,
  EthereumTransaction,
  EthereumTransactionData,
  ExchangeRate,
  FileAppendTransaction,
  FileCreateTransaction,
  FileDeleteTransaction,
  FileId,
  FileInfoQuery,
  Hbar,
  HbarUnit,
  Logger as HederaLogger,
  LogLevel,
  PublicKey,
  Query,
  Status,
  Transaction,
  TransactionRecord,
  TransactionRecordQuery,
  TransactionResponse,
} from '@hashgraph/sdk';
import { EventEmitter } from 'events';
import { Logger } from 'pino';

import { prepend0x, weibarHexToTinyBarInt } from '../../formatters';
import { Utils } from '../../utils';
import { CommonService } from '../services';
import { HbarLimitService } from '../services/hbarLimitService';
import { ITransactionRecordMetric, RequestDetails, TypedEvents } from '../types';
import constants from './../constants';
import { JsonRpcError, predefined } from './../errors/JsonRpcError';
import { SDKClientError } from './../errors/SDKClientError';

export class SDKClient {
  /**
   * The client to use for connecting to the main consensus network. The account
   * associated with this client will pay for all operations on the main network.
   */
  private readonly clientMain: Client;

  /**
   * The logger used for logging all output from this class.
   */
  private readonly logger: Logger;

  /**
   * Maximum number of chunks for file append transaction.
   */
  private readonly maxChunks: number;

  /**
   * Size of each chunk for file append transaction.
   */
  private readonly fileAppendChunkSize: number;

  /**
   * An instance of the HbarLimitService that tracks hbar expenses and limits.
   */
  private readonly hbarLimitService: HbarLimitService;

  /**
   * Constructs an instance of the SDKClient and initializes various services and settings.
   *
   * @param hederaNetwork - The network name for Hedera services.
   * @param logger - The logger instance for logging information, warnings, and errors.
   * @param eventEmitter - The eventEmitter used for emitting and handling events within the class.
   * @param hbarLimitService - The HbarLimitService that tracks hbar expenses and limits.
   */
  constructor(
    hederaNetwork: string,
    logger: Logger,
    private readonly eventEmitter: EventEmitter<TypedEvents>,
    hbarLimitService: HbarLimitService,
  ) {
    const clientTransportSecurity = ConfigService.get('CLIENT_TRANSPORT_SECURITY');
    const sdkRequestTimeout = ConfigService.get('SDK_REQUEST_TIMEOUT');
    const sdkMaxAttempts = ConfigService.get('SDK_MAX_ATTEMPTS');
    const sdkLogLevel = ConfigService.get('SDK_LOG_LEVEL');
    const sdkDeadline = this.determineSdkDeadline(logger);

    const client =
      hederaNetwork in constants.CHAIN_IDS
        ? Client.forName(hederaNetwork)
        : Client.forNetwork(JSON.parse(hederaNetwork));

    const operator = Utils.getOperator(logger);
    if (operator) {
      client.setOperator(operator.accountId, operator.privateKey);
    }

    const sdkLogger = new HederaLogger(LogLevel._fromString(sdkLogLevel)).setLogger(
      // @ts-ignore
      logger.child({ name: 'sdk-client' }, { level: sdkLogLevel }),
    );

    logger.info(
      `SDK client successfully configured: network=${JSON.stringify(hederaNetwork)}, transportSecurity=${clientTransportSecurity}, requestTimeout=${sdkRequestTimeout}ms, maxAttempts=${sdkMaxAttempts}, logLevel=${sdkLogLevel}, deadline=${sdkDeadline}ms.`,
    );

    this.clientMain = client
      .setTransportSecurity(clientTransportSecurity)
      .setRequestTimeout(sdkRequestTimeout)
      .setMaxAttempts(sdkMaxAttempts)
      .setMaxExecutionTime(sdkDeadline)
      .setLogger(sdkLogger);
    this.logger = logger;
    this.hbarLimitService = hbarLimitService;
    this.maxChunks = ConfigService.get('FILE_APPEND_MAX_CHUNKS');
    this.fileAppendChunkSize = ConfigService.get('FILE_APPEND_CHUNK_SIZE');
  }

  /**
   * Returns the operator account ID.
   *
   * @returns The operator account ID or `null` if not set.
   */
  public getOperatorAccountId(): AccountId | null {
    return this.clientMain.operatorAccountId;
  }

  /**
   * Returns the public key of the operator account.
   *
   * @returns The operator's public key or `null` if not set.
   */
  public getOperatorPublicKey(): PublicKey | null {
    return this.clientMain.operatorPublicKey;
  }

  /**
   * Submits an Ethereum transaction and handles call data that exceeds the maximum chunk size.
   * If the call data is too large, it creates a file to store the excess data and updates the transaction accordingly.
   * Also calculates and sets the maximum transaction fee based on the current gas price.
   *
   * @param {Uint8Array} transactionBuffer - The transaction data in bytes.
   * @param {string} callerName - The name of the caller initiating the transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {string} originalCallerAddress - The address of the original caller making the request.
   * @param {number} networkGasPriceInWeiBars - The predefined gas price of the network in weibar.
   * @param {number} currentNetworkExchangeRateInCents - The exchange rate in cents of the current network.
   * @returns {Promise<{ txResponse: TransactionResponse; fileId: FileId | null }>}
   * @throws {SDKClientError} Throws an error if no file ID is created or if the preemptive fee check fails.
   */
  public async submitEthereumTransaction(
    transactionBuffer: Uint8Array,
    callerName: string,
    requestDetails: RequestDetails,
    originalCallerAddress: string,
    networkGasPriceInWeiBars: number,
    currentNetworkExchangeRateInCents: number,
  ): Promise<{ txResponse: TransactionResponse; fileId: FileId | null }> {
    const jumboTxEnabled = ConfigService.get('JUMBO_TX_ENABLED');
    const ethereumTransactionData: EthereumTransactionData = EthereumTransactionData.fromBytes(transactionBuffer);
    const ethereumTransaction = new EthereumTransaction();
    const interactingEntity = ethereumTransactionData.toJSON()['to'].toString();

    let fileId: FileId | null = null;

    if (jumboTxEnabled || ethereumTransactionData.callData.length <= this.fileAppendChunkSize) {
      ethereumTransaction.setEthereumData(ethereumTransactionData.toBytes());
    } else {
      // if JUMBO_TX_ENABLED is false and callData's size is greater than `fileAppendChunkSize` => employ HFS to create new file to carry the rest of the contents of callData
      fileId = await this.createFile(
        ethereumTransactionData.callData,
        requestDetails,
        callerName,
        originalCallerAddress,
        currentNetworkExchangeRateInCents,
      );
      if (!fileId) {
        throw new SDKClientError({}, `No fileId created for transaction. `);
      }
      ethereumTransactionData.callData = new Uint8Array();
      ethereumTransaction.setEthereumData(ethereumTransactionData.toBytes()).setCallDataFileId(fileId);
    }

    ethereumTransaction.setMaxTransactionFee(
      Hbar.fromTinybars(
        Math.floor(weibarHexToTinyBarInt(networkGasPriceInWeiBars) * constants.MAX_TRANSACTION_FEE_THRESHOLD),
      ),
    );

    if (CommonService.isSubsidizedTransaction(interactingEntity)) {
      // see "Max Allowance" in the docs for more details https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/ethereum-transaction
      ethereumTransaction.setMaxGasAllowanceHbar(ConfigService.get('MAX_GAS_ALLOWANCE_HBAR'));
    }

    return {
      fileId,
      txResponse: await this.executeTransaction(
        ethereumTransaction,
        callerName,
        requestDetails,
        true,
        originalCallerAddress,
      ),
    };
  }

  /**
   * Executes a Hedera query and handles potential errors.
   * @param query - The Hedera query to execute.
   * @param callerName - The name of the caller executing the query.
   * @param requestDetails - The request details for logging and tracking.
   * @param originalCallerAddress - The optional address of the original caller making the request.
   * @returns A promise resolving to the query response.
   * @throws {Error} Throws an error if the query fails or if rate limits are exceeded.
   * @template T - The type of the query response.
   */
  private async executeQuery<T>(
    query: Query<T>,
    callerName: string,
    requestDetails: RequestDetails,
    originalCallerAddress?: string,
  ): Promise<T> {
    const queryConstructorName = query.constructor.name;
    let queryResponse: any = null;
    let queryCost: number | undefined = undefined;
    let status: string = '';

    this.logger.info(`Execute %s query.`, queryConstructorName);

    try {
      queryResponse = await query.execute(this.clientMain);
      queryCost = query._queryPayment?.toTinybars().toNumber();
      status = Status.Success.toString();
      this.logger.info(
        `Successfully execute %s query: callerName=%s, cost=%s tinybars`,
        queryConstructorName,
        callerName,
        queryCost,
      );
      return queryResponse;
    } catch (e: any) {
      const sdkClientError = new SDKClientError(e, e.message);

      queryCost = query._queryPayment?.toTinybars().toNumber();
      status = sdkClientError.status.toString();

      if (sdkClientError.isGrpcTimeout()) {
        throw predefined.REQUEST_TIMEOUT;
      }

      this.logger.debug(
        `Fail to execute %s callerName=%s, status=%s(%s), cost=%s tinybars`,
        queryConstructorName,
        callerName,
        sdkClientError.status,
        sdkClientError.status._code,
        queryCost,
      );

      throw sdkClientError;
    } finally {
      if (queryCost && queryCost !== 0) {
        this.eventEmitter.emit('execute_query', {
          executionMode: constants.EXECUTION_MODE.QUERY,
          transactionId: query.paymentTransactionId?.toString() ?? '',
          txConstructorName: queryConstructorName,
          cost: queryCost,
          gasUsed: 0,
          status,
          requestDetails,
          originalCallerAddress,
        });
      }
    }
  }

  /**
   * Executes a single transaction, handling rate limits, logging, and metrics.
   *
   * @param transaction - The transaction to execute.
   * @param callerName - The name of the caller requesting the transaction.
   * @param requestDetails - The request details for logging and tracking.
   * @param shouldThrowHbarLimit - Flag to indicate whether to check HBAR limits.
   * @param originalCallerAddress - The address of the original caller making the request.
   * @param estimatedTxFee - The optional total estimated transaction fee.
   * @returns - A promise that resolves to the transaction response.
   * @throws {SDKClientError} - Throws if an error occurs during transaction execution.
   */
  private async executeTransaction(
    transaction: Transaction,
    callerName: string,
    requestDetails: RequestDetails,
    shouldThrowHbarLimit: boolean,
    originalCallerAddress: string,
    estimatedTxFee?: number,
  ): Promise<TransactionResponse> {
    const txConstructorName = transaction.constructor.name;
    let transactionId: string = '';
    let transactionResponse: TransactionResponse | null = null;

    if (shouldThrowHbarLimit) {
      const shouldLimit = await this.hbarLimitService.shouldLimit(
        constants.EXECUTION_MODE.TRANSACTION,
        callerName,
        txConstructorName,
        originalCallerAddress,
        requestDetails,
        estimatedTxFee,
      );

      if (shouldLimit) {
        throw predefined.HBAR_RATE_LIMIT_EXCEEDED;
      }
    }

    try {
      this.logger.info(`Execute %s transaction`, txConstructorName);
      transactionResponse = await transaction.execute(this.clientMain);

      transactionId = transactionResponse.transactionId.toString();

      // .getReceipt() will throw an error if, in any case, the status !== 22 (SUCCESS).
      const transactionReceipt = await transactionResponse.getReceipt(this.clientMain);

      this.logger.info(
        `Successfully execute %s transaction: transactionId=%s, callerName=%s, status=%s(%s)`,
        txConstructorName,
        transactionResponse.transactionId,
        callerName,
        transactionReceipt.status,
        transactionReceipt.status._code,
      );
      return transactionResponse;
    } catch (e: any) {
      this.logger.warn(
        e,
        `Transaction failed while executing transaction via the SDK: transactionId=%s, callerName=%s, txConstructorName=%s`,
        transaction.transactionId,
        callerName,
        txConstructorName,
      );

      if (e instanceof JsonRpcError) {
        throw e;
      }

      throw new SDKClientError(e, e.message, transactionId || transaction.transactionId?.toString(), e.nodeAccountId);
    } finally {
      if (transactionId?.length) {
        const transactionHash = transactionResponse?.transactionHash
          ? prepend0x(Buffer.from(transactionResponse.transactionHash).toString('hex'))
          : undefined;

        this.eventEmitter.emit('execute_transaction', {
          transactionId,
          transactionHash,
          txConstructorName,
          operatorAccountId: this.clientMain.operatorAccountId!.toString(),
          requestDetails,
          originalCallerAddress,
        });
      }
    }
  }

  /**
   * Executes all transactions in a batch, checks HBAR limits, retrieves metrics, and captures expenses.
   *
   * @param transaction - The batch transaction to execute.
   * @param callerName - The name of the caller requesting the transaction.
   * @param requestDetails - The request details for logging and tracking.
   * @param shouldThrowHbarLimit - Flag to indicate whether to check HBAR limits.
   * @param originalCallerAddress - The address of the original caller making the request.
   * @param estimatedTxFee - The optioanl total estimated transaction fee.
   * @returns A promise that resolves when the batch execution is complete.
   * @throws {SDKClientError} - Throws if an error occurs during batch transaction execution.
   */
  private async executeAllTransaction(
    transaction: FileAppendTransaction,
    callerName: string,
    requestDetails: RequestDetails,
    shouldThrowHbarLimit: boolean,
    originalCallerAddress: string,
    estimatedTxFee?: number,
  ): Promise<void> {
    const txConstructorName = transaction.constructor.name;
    let transactionResponses: TransactionResponse[] | null = null;

    if (shouldThrowHbarLimit) {
      const shouldLimit = await this.hbarLimitService.shouldLimit(
        constants.EXECUTION_MODE.TRANSACTION,
        callerName,
        txConstructorName,
        originalCallerAddress,
        requestDetails,
        estimatedTxFee,
      );

      if (shouldLimit) {
        throw predefined.HBAR_RATE_LIMIT_EXCEEDED;
      }
    }

    try {
      this.logger.info(`Execute %s transaction`, txConstructorName);
      transactionResponses = await transaction.executeAll(this.clientMain);

      this.logger.info(
        `Successfully execute all %s %s transactions: callerName=%s, status=%s(%s)`,
        transactionResponses.length,
        txConstructorName,
        callerName,
        Status.Success,
        Status.Success._code,
      );
    } catch (e: any) {
      const sdkClientError = new SDKClientError(e, e.message, undefined, e.nodeAccountId);
      this.logger.warn(
        `Fail to executeAll for %s transaction: transactionId=%s, callerName=%s, transactionType=%s, status=%s(%s)`,
        txConstructorName,
        transaction.transactionId,
        callerName,
        txConstructorName,
        sdkClientError.status,
        sdkClientError.status._code,
      );
      throw sdkClientError;
    } finally {
      if (transactionResponses) {
        for (const transactionResponse of transactionResponses) {
          if (transactionResponse.transactionId) {
            this.eventEmitter.emit('execute_transaction', {
              transactionId: transactionResponse.transactionId.toString(),
              txConstructorName,
              operatorAccountId: this.clientMain.operatorAccountId!.toString(),
              requestDetails,
              originalCallerAddress,
            });
          }
        }
      }
    }
  }

  /**
   * Creates a file on the Hedera network using the provided call data.
   * @param callData - The data to be written to the file.
   * @param requestDetails - The request details for logging and tracking.
   * @param callerName - The name of the caller creating the file.
   * @param originalCallerAddress - The address of the original caller making the request.
   * @param currentNetworkExchangeRateInCents - The current network exchange rate in cents per HBAR.
   * @returns A promise that resolves to the created file ID or null if the creation failed.
   * @throws Will throw an error if the created file is empty or if any transaction fails during execution.
   */
  private async createFile(
    callData: Uint8Array,
    requestDetails: RequestDetails,
    callerName: string,
    originalCallerAddress: string,
    currentNetworkExchangeRateInCents: number,
  ): Promise<FileId | null> {
    const hexedCallData = Buffer.from(callData).toString('hex');

    const estimatedTxFee = Utils.estimateFileTransactionsFee(
      hexedCallData.length,
      this.fileAppendChunkSize,
      currentNetworkExchangeRateInCents,
    );

    const shouldPreemptivelyLimit = await this.hbarLimitService.shouldLimit(
      constants.EXECUTION_MODE.TRANSACTION,
      callerName,
      this.createFile.name,
      originalCallerAddress,
      requestDetails,
      estimatedTxFee,
    );

    if (shouldPreemptivelyLimit) {
      throw predefined.HBAR_RATE_LIMIT_EXCEEDED;
    }

    const fileCreateTx = new FileCreateTransaction()
      .setContents(hexedCallData.substring(0, this.fileAppendChunkSize))
      .setKeys(this.clientMain.operatorPublicKey ? [this.clientMain.operatorPublicKey] : []);

    const fileCreateTxResponse = await this.executeTransaction(
      fileCreateTx,
      callerName,
      requestDetails,
      false,
      originalCallerAddress,
    );

    const { fileId } = await fileCreateTxResponse.getReceipt(this.clientMain);

    if (fileId && callData.length > this.fileAppendChunkSize) {
      const fileAppendTx = new FileAppendTransaction()
        .setFileId(fileId)
        .setContents(hexedCallData.substring(this.fileAppendChunkSize, hexedCallData.length))
        .setChunkSize(this.fileAppendChunkSize)
        .setMaxChunks(this.maxChunks);

      await this.executeAllTransaction(fileAppendTx, callerName, requestDetails, false, originalCallerAddress);
    }

    if (fileId) {
      const fileInfo = await this.executeQuery(
        new FileInfoQuery().setFileId(fileId),
        callerName,
        requestDetails,
        originalCallerAddress,
      );

      if (fileInfo.size.isZero()) {
        this.logger.warn(`File %s is empty.`, fileId);
        throw new SDKClientError({}, 'Created file is empty.');
      }
      this.logger.trace(`Created file with fileId: %s and file size %s`, fileId, fileInfo.size);
    }

    return fileId;
  }

  /**
   * Deletes a file on the Hedera network and verifies its deletion.
   *
   * @param fileId - The ID of the file to be deleted.
   * @param requestDetails - The request details for logging and tracking.
   * @param callerName - The name of the entity initiating the request.
   * @param originalCallerAddress - The address of the original caller making the request.
   * @returns A promise that resolves when the operation is complete.
   * @throws Throws an error if the file deletion fails.
   */
  public async deleteFile(
    fileId: FileId,
    requestDetails: RequestDetails,
    callerName: string,
    originalCallerAddress: string,
  ): Promise<void> {
    try {
      const fileDeleteTx = new FileDeleteTransaction()
        .setFileId(fileId)
        .setMaxTransactionFee(new Hbar(2))
        .freezeWith(this.clientMain);

      await this.executeTransaction(fileDeleteTx, callerName, requestDetails, false, originalCallerAddress);

      const fileInfo = await this.executeQuery(
        new FileInfoQuery().setFileId(fileId),
        callerName,
        requestDetails,
        originalCallerAddress,
      );

      if (fileInfo.isDeleted) {
        this.logger.trace(`Deleted file with fileId: %s`, fileId);
      } else {
        this.logger.warn(`Fail to delete file with fileId: %s`, fileId);
      }
    } catch (error: any) {
      this.logger.warn(`%s`, error['message']);
    }
  }

  /**
   * Retrieves transaction record metrics for a given transaction ID.
   *
   * @param transactionId - The ID of the transaction to retrieve metrics for.
   * @param txConstructorName - The name of the transaction constructor.
   * @param operatorAccountId - The account ID of the operator.
   * @returns A promise that resolves to an object containing transaction metrics.
   * @throws {SDKClientError} - Throws an error if an issue occurs during the transaction record query.
   */
  public async getTransactionRecordMetrics(
    transactionId: string,
    txConstructorName: string,
    operatorAccountId: string,
  ): Promise<ITransactionRecordMetric> {
    let gasUsed: number = 0;
    let transactionFee: number = 0;
    let txRecordChargeAmount: number = 0;
    try {
      this.logger.debug(
        `Get transaction record via consensus node: transactionId=%s, txConstructorName=%s`,
        transactionId,
        txConstructorName,
      );

      const transactionRecord = await new TransactionRecordQuery()
        .setTransactionId(transactionId)
        .setValidateReceiptStatus(false)
        .execute(this.clientMain);

      const transactionReceipt = transactionRecord.receipt;
      const status = transactionReceipt.status.toString();

      txRecordChargeAmount = this.calculateTxRecordChargeAmount(transactionReceipt.exchangeRate!);

      transactionFee = this.getTransferAmountSumForAccount(transactionRecord, operatorAccountId);
      gasUsed = transactionRecord.contractFunctionResult?.gasUsed.toNumber() ?? 0;

      return { transactionFee, txRecordChargeAmount, gasUsed, status };
    } catch (e: any) {
      const sdkClientError = new SDKClientError(e, e.message);
      this.logger.warn(
        e,
        `Error raised during TransactionRecordQuery: transactionId=%s, txConstructorName=%s, recordStatus=%s (%s), cost=%s, gasUsed=%s`,
        transactionId,
        txConstructorName,
        sdkClientError.status,
        sdkClientError.status._code,
        transactionFee,
        gasUsed,
      );
      throw sdkClientError;
    }
  }

  /**
   * Calculates the total sum of transfer amounts for a specific account from a transaction record.
   * This method filters the transfers in the transaction record to match the specified account ID,
   * then sums up the amounts by subtracting each transfer's amount (converted to tinybars) from the accumulator.
   *
   * @param {TransactionRecord} transactionRecord - The transaction record containing transfer details.
   * @param {string} accountId - The ID of the account for which the transfer sum is to be calculated.
   * @returns {number} The total sum of transfer amounts for the specified account, in tinybars.
   */
  private getTransferAmountSumForAccount(transactionRecord: TransactionRecord, accountId: string): number {
    return transactionRecord.transfers
      .filter((transfer) => transfer.accountId.toString() === accountId && transfer.amount.isNegative())
      .reduce((acc, transfer) => {
        return acc - transfer.amount.toTinybars().toNumber();
      }, 0);
  }

  /**
   * Calculates the transaction record query cost in tinybars based on the given exchange rate in cents.
   *
   * @param {number} exchangeRate - The exchange rate in cents used to convert the transaction query cost.
   * @returns {number} - The transaction record query cost in tinybars.
   */
  private calculateTxRecordChargeAmount(exchangeRate: ExchangeRate): number {
    const exchangeRateInCents = exchangeRate.exchangeRateInCents;
    const hbarToTinybar = Hbar.from(1, HbarUnit.Hbar).toTinybars().toNumber();
    return Math.round((constants.NETWORK_FEES_IN_CENTS.TRANSACTION_GET_RECORD / exchangeRateInCents) * hbarToTinybar);
  }

  /**
   * Determines the SDK deadline value, handling the precedence between SDK_GRPC_DEADLINE and the legacy CONSENSUS_MAX_EXECUTION_TIME.
   *
   * SDK_GRPC_DEADLINE is the preferred configuration option.
   * CONSENSUS_MAX_EXECUTION_TIME is deprecated and maintained only for backward compatibility.
   *
   * Precedence order:
   * 1. SDK_GRPC_DEADLINE (if set)
   * 2. CONSENSUS_MAX_EXECUTION_TIME (legacy fallback)
   * 3. SDK_GRPC_DEADLINE default value
   *
   * @param logger - The logger instance for logging warnings.
   * @returns The SDK deadline value in milliseconds.
   */
  private determineSdkDeadline(logger: Logger): number {
    const sdkGrpcDeadlineEnv = process.env.SDK_GRPC_DEADLINE;
    const consensusMaxExecutionTimeEnv = process.env.CONSENSUS_MAX_EXECUTION_TIME;

    // Case 1: Both are explicitly set - use SDK_GRPC_DEADLINE and warn about redundant configuration
    if (sdkGrpcDeadlineEnv !== undefined && consensusMaxExecutionTimeEnv !== undefined) {
      logger.warn(
        `Detected both SDK_GRPC_DEADLINE and CONSENSUS_MAX_EXECUTION_TIME in configuration. CONSENSUS_MAX_EXECUTION_TIME is deprecated; please remove it and use SDK_GRPC_DEADLINE exclusively.`,
      );
      return ConfigService.get('SDK_GRPC_DEADLINE');
    }

    // Case 2: Only SDK_GRPC_DEADLINE is set - preferred path
    if (sdkGrpcDeadlineEnv !== undefined) {
      return ConfigService.get('SDK_GRPC_DEADLINE');
    }

    // Case 3: Only CONSENSUS_MAX_EXECUTION_TIME is set - legacy configuration, advise migration
    if (consensusMaxExecutionTimeEnv !== undefined) {
      logger.warn(
        `CONSENSUS_MAX_EXECUTION_TIME is deprecated and will be removed in a future release. Please migrate to SDK_GRPC_DEADLINE for configuring the max execution time for the SDK.`,
      );
      return ConfigService.get('CONSENSUS_MAX_EXECUTION_TIME');
    }

    // Case 4: Neither is set - use SDK_GRPC_DEADLINE default
    return ConfigService.get('SDK_GRPC_DEADLINE');
  }
}
