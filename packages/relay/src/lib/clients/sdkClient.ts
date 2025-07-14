// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import {
  AccountId,
  Client,
  ContractCallQuery,
  ContractFunctionResult,
  ContractId,
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
  PrecheckStatusError,
  Query,
  Status,
  Transaction,
  TransactionId,
  TransactionRecord,
  TransactionRecordQuery,
  TransactionResponse,
} from '@hashgraph/sdk';
import { EventEmitter } from 'events';
import { Logger } from 'pino';

import { weibarHexToTinyBarInt } from '../../formatters';
import { Utils } from '../../utils';
import { HbarLimitService } from '../services/hbarLimitService';
import {
  IExecuteQueryEventPayload,
  IExecuteTransactionEventPayload,
  ITransactionRecordMetric,
  RequestDetails,
} from '../types';
import constants from './../constants';
import { JsonRpcError, predefined } from './../errors/JsonRpcError';
import { SDKClientError } from './../errors/SDKClientError';

export class SDKClient {
  /**
   * The client to use for connecting to the main consensus network. The account
   * associated with this client will pay for all operations on the main network.
   *
   * @private
   */
  private readonly clientMain: Client;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * Maximum number of chunks for file append transaction.
   * @private
   */
  private readonly maxChunks: number;

  /**
   * Size of each chunk for file append transaction.
   * @private
   */
  private readonly fileAppendChunkSize: number;

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
   * Constructs an instance of the SDKClient and initializes various services and settings.
   *
   * @param {Client} clientMain - The primary Hedera client instance used for executing transactions and queries.
   * @param {Logger} logger - The logger instance for logging information, warnings, and errors.
   * @param {EventEmitter} eventEmitter - The eventEmitter used for emitting and handling events within the class.
   */
  constructor(clientMain: Client, logger: Logger, eventEmitter: EventEmitter, hbarLimitService: HbarLimitService) {
    this.clientMain = clientMain;

    // sets the maximum time in ms for the SDK to wait when submitting
    // a transaction/query before throwing a TIMEOUT error
    this.clientMain = clientMain.setMaxExecutionTime(ConfigService.get('CONSENSUS_MAX_EXECUTION_TIME'));

    this.logger = logger;
    this.eventEmitter = eventEmitter;
    this.hbarLimitService = hbarLimitService;
    this.maxChunks = ConfigService.get('FILE_APPEND_MAX_CHUNKS');
    this.fileAppendChunkSize = ConfigService.get('FILE_APPEND_CHUNK_SIZE');
  }

  /**
   * Return current main client instance
   * @returns Main Client
   */
  public getMainClientInstance() {
    return this.clientMain;
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
  async submitEthereumTransaction(
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
        this.clientMain,
        requestDetails,
        callerName,
        interactingEntity,
        originalCallerAddress,
        currentNetworkExchangeRateInCents,
      );
      if (!fileId) {
        throw new SDKClientError({}, `${requestDetails.formattedRequestId} No fileId created for transaction. `);
      }
      ethereumTransactionData.callData = new Uint8Array();
      ethereumTransaction.setEthereumData(ethereumTransactionData.toBytes()).setCallDataFileId(fileId);
    }

    ethereumTransaction.setMaxTransactionFee(
      Hbar.fromTinybars(
        Math.floor(weibarHexToTinyBarInt(networkGasPriceInWeiBars) * constants.MAX_TRANSACTION_FEE_THRESHOLD),
      ),
    );

    return {
      fileId,
      txResponse: await this.executeTransaction(
        ethereumTransaction,
        callerName,
        interactingEntity,
        requestDetails,
        true,
        originalCallerAddress,
      ),
    };
  }

  /**
   * Submits a contract call query to a smart contract on the Hedera network.
   * @param {string} to - The address of the contract to call, in either Solidity or EVM format.
   * @param {string} data - The encoded function parameters for the contract call, in hexadecimal format.
   * @param {number} gas - The amount of gas to use for the contract call.
   * @param {string} from - The address of the sender in EVM format.
   * @param {string} callerName - The name of the caller for logging purposes.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<ContractFunctionResult>} The result of the contract function call.
   * @throws {SDKClientError} Throws an SDK client error if the contract call query fails.
   */
  async submitContractCallQuery(
    to: string,
    data: string,
    gas: number,
    from: string,
    callerName: string,
    requestDetails: RequestDetails,
  ): Promise<ContractFunctionResult> {
    const contract = SDKClient.prune0x(to);
    const contractId = contract.startsWith('00000000000')
      ? ContractId.fromSolidityAddress(contract)
      : ContractId.fromEvmAddress(0, 0, contract);

    const contractCallQuery = new ContractCallQuery().setContractId(contractId).setGas(gas);

    // data is optional and can be omitted in which case fallback function will be employed
    if (data) {
      contractCallQuery.setFunctionParameters(Buffer.from(SDKClient.prune0x(data), 'hex'));
    }

    if (from) {
      contractCallQuery.setSenderAccountId(AccountId.fromEvmAddress(0, 0, from));
    }

    if (this.clientMain.operatorAccountId !== null) {
      contractCallQuery.setPaymentTransactionId(TransactionId.generate(this.clientMain.operatorAccountId));
    }

    return this.executeQuery(contractCallQuery, this.clientMain, callerName, to, requestDetails, from);
  }

  /**
   * Submits a contract call query with retries in case of timeout errors.
   * @param {string} to - The address of the contract to call.
   * @param {string} data - The data to send with the contract call.
   * @param {number} gas - The amount of gas to use for the contract call.
   * @param {string} from - The address from which the contract call is made.
   * @param {string} callerName - The name of the caller for logging purposes.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<ContractFunctionResult>} The result of the contract function call.
   * @throws {JsonRpcError} Throws an error if the error is a JSON-RPC error.
   * @throws {SDKClientError} Throws an SDK client error if the error is not a timeout error or if the retries are exhausted.
   */
  async submitContractCallQueryWithRetry(
    to: string,
    data: string,
    gas: number,
    from: string,
    callerName: string,
    requestDetails: RequestDetails,
  ): Promise<ContractFunctionResult> {
    let retries = 0;
    let resp;
    while (ConfigService.get('CONTRACT_QUERY_TIMEOUT_RETRIES') > retries) {
      try {
        resp = await this.submitContractCallQuery(to, data, gas, from, callerName, requestDetails);
        return resp;
      } catch (e: any) {
        const sdkClientError = new SDKClientError(e, e.message);
        if (sdkClientError.isTimeoutExceeded()) {
          const delay = retries * 1000;
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(
              `${requestDetails.formattedRequestId} Contract call query failed with status ${sdkClientError.message}. Retrying again after ${delay} ms ...`,
            );
          }
          retries++;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        if (e instanceof JsonRpcError) {
          throw e;
        }
        throw sdkClientError;
      }
    }
    return resp;
  }

  /**
   * Increases the query cost and retries the query execution if the initial attempt fails due to insufficient transaction fees.
   * @param {Query<any>} query - The query to be executed.
   * @param {Hbar} baseCost - The base cost of the query.
   * @param {Client} client - The client to use for executing the query.
   * @param {number} maxRetries - The maximum number of retries allowed.
   * @param {number} currentRetry - The current retry attempt number.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<{resp: any, cost: Hbar}>} The response of the query execution and the cost used.
   * @throws Will throw an error if the maximum number of retries is exceeded or if the error is not due to insufficient transaction fees.
   */
  async increaseCostAndRetryExecution(
    query: Query<any>,
    baseCost: Hbar,
    client: Client,
    maxRetries: number,
    currentRetry: number,
    requestDetails: RequestDetails,
  ): Promise<{ resp: any; cost: Hbar }> {
    const baseMultiplier = constants.QUERY_COST_INCREMENTATION_STEP;
    const multiplier = Math.pow(baseMultiplier, currentRetry);

    const cost = Hbar.fromTinybars(baseCost._valueInTinybar.multipliedBy(multiplier).toFixed(0));

    try {
      const resp = await query.setQueryPayment(cost).execute(client);
      return { resp, cost };
    } catch (e: any) {
      const sdkClientError = new SDKClientError(e, e.message);
      if (maxRetries > currentRetry && sdkClientError.isInsufficientTxFee()) {
        const newRetry = currentRetry + 1;
        this.logger.info(
          `${requestDetails.formattedRequestId} Retrying query execution with increased cost, retry number: ${newRetry}`,
        );
        return await this.increaseCostAndRetryExecution(query, baseCost, client, maxRetries, newRetry, requestDetails);
      }

      throw e;
    }
  }

  /**
   * Executes a Hedera query and handles potential errors.
   * @param {Query<T>} query - The Hedera query to execute.
   * @param {Client} client - The Hedera client to use for the query.
   * @param {string} callerName - The name of the caller executing the query.
   * @param {string} interactingEntity - The entity interacting with the query.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {string} [originalCallerAddress] - The optional address of the original caller making the request.
   * @returns {Promise<T>} A promise resolving to the query response.
   * @throws {Error} Throws an error if the query fails or if rate limits are exceeded.
   * @template T - The type of the query response.
   */
  async executeQuery<T>(
    query: Query<T>,
    client: Client,
    callerName: string,
    interactingEntity: string,
    requestDetails: RequestDetails,
    originalCallerAddress?: string,
  ): Promise<T> {
    const queryConstructorName = query.constructor.name;
    const requestIdPrefix = requestDetails.formattedRequestId;
    let queryResponse: any = null;
    let queryCost: number | undefined = undefined;
    let status: string = '';

    this.logger.info(`${requestIdPrefix} Execute ${queryConstructorName} query.`);

    try {
      if (query.paymentTransactionId) {
        const baseCost = await query.getCost(this.clientMain);
        const res = await this.increaseCostAndRetryExecution(query, baseCost, client, 3, 0, requestDetails);
        queryResponse = res.resp;
        queryCost = res.cost.toTinybars().toNumber();
      } else {
        queryResponse = await query.execute(client);
        queryCost = query._queryPayment?.toTinybars().toNumber();
      }

      status = Status.Success.toString();

      this.logger.info(
        `${requestIdPrefix} Successfully execute ${queryConstructorName} query: paymentTransactionId=${query.paymentTransactionId}, callerName=${callerName}, cost=${queryCost} tinybars`,
      );
      return queryResponse;
    } catch (e: any) {
      const sdkClientError = new SDKClientError(e, e.message);

      queryCost = query._queryPayment?.toTinybars().toNumber();
      status = sdkClientError.status.toString();

      if (e instanceof PrecheckStatusError && e.contractFunctionResult?.errorMessage) {
        throw predefined.CONTRACT_REVERT(e.contractFunctionResult.errorMessage);
      }
      if (sdkClientError.isGrpcTimeout()) {
        throw predefined.REQUEST_TIMEOUT;
      }

      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} Fail to execute ${queryConstructorName} query: paymentTransactionId=${query.paymentTransactionId}, callerName=${callerName}, status=${sdkClientError.status}(${sdkClientError.status._code}), cost=${queryCost} tinybars`,
        );
      }

      throw sdkClientError;
    } finally {
      if (queryCost && queryCost !== 0) {
        this.eventEmitter.emit(constants.EVENTS.EXECUTE_QUERY, {
          executionMode: constants.EXECUTION_MODE.QUERY,
          transactionId: query.paymentTransactionId?.toString(),
          txConstructorName: queryConstructorName,
          cost: queryCost,
          gasUsed: 0,
          status,
          requestDetails,
          originalCallerAddress,
        } as IExecuteQueryEventPayload);
      }
    }
  }

  /**
   * Executes a single transaction, handling rate limits, logging, and metrics.
   *
   * @param {Transaction} transaction - The transaction to execute.
   * @param {string} callerName - The name of the caller requesting the transaction.
   * @param {string} interactingEntity - The entity interacting with the transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {boolean} shouldThrowHbarLimit - Flag to indicate whether to check HBAR limits.
   * @param {string} originalCallerAddress - The address of the original caller making the request.
   * @param {number} [estimatedTxFee] - The optioanl total estimated transaction fee.
   * @returns {Promise<TransactionResponse>} - A promise that resolves to the transaction response.
   * @throws {SDKClientError} - Throws if an error occurs during transaction execution.
   */
  async executeTransaction(
    transaction: Transaction,
    callerName: string,
    interactingEntity: string,
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
      this.logger.info(`${requestDetails.formattedRequestId} Execute ${txConstructorName} transaction`);
      transactionResponse = await transaction.execute(this.clientMain);

      transactionId = transactionResponse.transactionId.toString();

      // .getReceipt() will throw an error if, in any case, the status !== 22 (SUCCESS).
      const transactionReceipt = await transactionResponse.getReceipt(this.clientMain);

      this.logger.info(
        `${requestDetails.formattedRequestId} Successfully execute ${txConstructorName} transaction: transactionId=${transactionResponse.transactionId}, callerName=${callerName}, status=${transactionReceipt.status}(${transactionReceipt.status._code})`,
      );
      return transactionResponse;
    } catch (e: any) {
      this.logger.warn(
        e,
        `${requestDetails.formattedRequestId} Transaction failed while executing transaction via the SDK: transactionId=${transaction.transactionId}, callerName=${callerName}, txConstructorName=${txConstructorName}`,
      );

      if (e instanceof JsonRpcError) {
        throw e;
      }

      const sdkClientError = new SDKClientError(e, e.message, transaction.transactionId?.toString(), e.nodeAccountId);

      // WRONG_NONCE is one of the special errors where the SDK still returns a valid transactionResponse.
      // Throw the WRONG_NONCE error, as additional handling logic is expected in a higher layer.
      if (sdkClientError.status && sdkClientError.status === Status.WrongNonce) {
        throw sdkClientError;
      }

      if (!transactionResponse) {
        // Transactions may experience "SDK timeout exceeded" or "Connection Dropped" errors from the SDK, yet they may still be able to reach the consensus layer.
        // Throw Connection Drop and Timeout errors as additional handling logic is expected in a higher layer.
        if (sdkClientError.isConnectionDropped() || sdkClientError.isTimeoutExceeded()) {
          throw sdkClientError;
        } else {
          throw predefined.INTERNAL_ERROR(
            `${requestDetails.formattedRequestId} Transaction execution returns a null value: transactionId=${transaction.transactionId}, callerName=${callerName}, txConstructorName=${txConstructorName}`,
          );
        }
      }
      return transactionResponse;
    } finally {
      if (transactionId?.length) {
        this.eventEmitter.emit(constants.EVENTS.EXECUTE_TRANSACTION, {
          transactionId,
          requestDetails,
          txConstructorName,
          operatorAccountId: this.clientMain.operatorAccountId!.toString(),
          originalCallerAddress,
        } as IExecuteTransactionEventPayload);
      }
    }
  }

  /**
   * Executes all transactions in a batch, checks HBAR limits, retrieves metrics, and captures expenses.
   *
   * @param {FileAppendTransaction} transaction - The batch transaction to execute.
   * @param {string} callerName - The name of the caller requesting the transaction.
   * @param {string} interactingEntity - The entity interacting with the transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {boolean} shouldThrowHbarLimit - Flag to indicate whether to check HBAR limits.
   * @param {string} originalCallerAddress - The address of the original caller making the request.
   * @param {number} [estimatedTxFee] - The optioanl total estimated transaction fee.
   * @returns {Promise<void>} - A promise that resolves when the batch execution is complete.
   * @throws {SDKClientError} - Throws if an error occurs during batch transaction execution.
   */
  async executeAllTransaction(
    transaction: FileAppendTransaction,
    callerName: string,
    interactingEntity: string,
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
      this.logger.info(`${requestDetails.formattedRequestId} Execute ${txConstructorName} transaction`);
      transactionResponses = await transaction.executeAll(this.clientMain);

      this.logger.info(
        `${requestDetails.formattedRequestId} Successfully execute all ${transactionResponses.length} ${txConstructorName} transactions: callerName=${callerName}, status=${Status.Success}(${Status.Success._code})`,
      );
    } catch (e: any) {
      const sdkClientError = new SDKClientError(e, e.message, undefined, e.nodeAccountId);

      this.logger.warn(
        `${requestDetails.formattedRequestId} Fail to executeAll for ${txConstructorName} transaction: transactionId=${transaction.transactionId}, callerName=${callerName}, transactionType=${txConstructorName}, status=${sdkClientError.status}(${sdkClientError.status._code})`,
      );
      throw sdkClientError;
    } finally {
      if (transactionResponses) {
        for (const transactionResponse of transactionResponses) {
          if (transactionResponse.transactionId) {
            this.eventEmitter.emit(constants.EVENTS.EXECUTE_TRANSACTION, {
              transactionId: transactionResponse.transactionId.toString(),
              requestDetails,
              txConstructorName,
              operatorAccountId: this.clientMain.operatorAccountId!.toString(),
              originalCallerAddress,
            } as IExecuteTransactionEventPayload);
          }
        }
      }
    }
  }

  /**
   * Creates a file on the Hedera network using the provided call data.
   * @param {Uint8Array} callData - The data to be written to the file.
   * @param {Client} client - The Hedera client to use for the transaction.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {string} callerName - The name of the caller creating the file.
   * @param {string} interactingEntity - The entity interacting with the transaction.
   * @param {string} originalCallerAddress - The address of the original caller making the request.
   * @param {number} currentNetworkExchangeRateInCents - The current network exchange rate in cents per HBAR.
   * @returns {Promise<FileId | null>} A promise that resolves to the created file ID or null if the creation failed.
   * @throws Will throw an error if the created file is empty or if any transaction fails during execution.
   */
  async createFile(
    callData: Uint8Array,
    client: Client,
    requestDetails: RequestDetails,
    callerName: string,
    interactingEntity: string,
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
      .setKeys(client.operatorPublicKey ? [client.operatorPublicKey] : []);

    const fileCreateTxResponse = await this.executeTransaction(
      fileCreateTx,
      callerName,
      interactingEntity,
      requestDetails,
      false,
      originalCallerAddress,
    );

    const { fileId } = await fileCreateTxResponse.getReceipt(client);

    if (fileId && callData.length > this.fileAppendChunkSize) {
      const fileAppendTx = new FileAppendTransaction()
        .setFileId(fileId)
        .setContents(hexedCallData.substring(this.fileAppendChunkSize, hexedCallData.length))
        .setChunkSize(this.fileAppendChunkSize)
        .setMaxChunks(this.maxChunks);

      await this.executeAllTransaction(
        fileAppendTx,
        callerName,
        interactingEntity,
        requestDetails,
        false,
        originalCallerAddress,
      );
    }

    if (fileId) {
      const fileInfo = await this.executeQuery(
        new FileInfoQuery().setFileId(fileId),
        this.clientMain,
        callerName,
        interactingEntity,
        requestDetails,
        originalCallerAddress,
      );

      if (fileInfo.size.isZero()) {
        this.logger.warn(`${requestDetails.formattedRequestId} File ${fileId} is empty.`);
        throw new SDKClientError({}, `${requestDetails.formattedRequestId} Created file is empty. `);
      }
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} Created file with fileId: ${fileId} and file size ${fileInfo.size}`,
        );
      }
    }

    return fileId;
  }

  /**
   * Deletes a file on the Hedera network and verifies its deletion.
   *
   * @param {FileId} fileId - The ID of the file to be deleted.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {string} callerName - The name of the entity initiating the request.
   * @param {string} interactingEntity - The name of the interacting entity.
   * @param {string} originalCallerAddress - The address of the original caller making the request.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   * @throws {any} - Throws an error if the file deletion fails.
   */
  async deleteFile(
    fileId: FileId,
    requestDetails: RequestDetails,
    callerName: string,
    interactingEntity: string,
    originalCallerAddress: string,
  ): Promise<void> {
    try {
      const fileDeleteTx = new FileDeleteTransaction()
        .setFileId(fileId)
        .setMaxTransactionFee(new Hbar(2))
        .freezeWith(this.clientMain);

      await this.executeTransaction(
        fileDeleteTx,
        callerName,
        interactingEntity,
        requestDetails,
        false,
        originalCallerAddress,
      );

      const fileInfo = await this.executeQuery(
        new FileInfoQuery().setFileId(fileId),
        this.clientMain,
        callerName,
        interactingEntity,
        requestDetails,
        originalCallerAddress,
      );

      if (fileInfo.isDeleted) {
        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(`${requestDetails.formattedRequestId} Deleted file with fileId: ${fileId}`);
        }
      } else {
        this.logger.warn(`${requestDetails.formattedRequestId} Fail to delete file with fileId: ${fileId} `);
      }
    } catch (error: any) {
      this.logger.warn(`${requestDetails.formattedRequestId} ${error['message']} `);
    }
  }

  /**
   * Retrieves transaction record metrics for a given transaction ID.
   *
   * @param {string} transactionId - The ID of the transaction to retrieve metrics for.
   * @param {string} callerName - The name of the caller requesting the transaction record.
   * @param {string} txConstructorName - The name of the transaction constructor.
   * @param {string} operatorAccountId - The account ID of the operator.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<ITransactionRecordMetric>} - A promise that resolves to an object containing transaction metrics.
   * @throws {SDKClientError} - Throws an error if an issue occurs during the transaction record query.
   */
  public async getTransactionRecordMetrics(
    transactionId: string,
    txConstructorName: string,
    operatorAccountId: string,
    requestDetails: RequestDetails,
  ): Promise<ITransactionRecordMetric> {
    let gasUsed: number = 0;
    let transactionFee: number = 0;
    let txRecordChargeAmount: number = 0;
    try {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} Get transaction record via consensus node: transactionId=${transactionId}, txConstructorName=${txConstructorName}`,
        );
      }

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
        `${requestDetails.formattedRequestId} Error raised during TransactionRecordQuery: transactionId=${transactionId}, txConstructorName=${txConstructorName}, recordStatus=${sdkClientError.status} (${sdkClientError.status._code}), cost=${transactionFee}, gasUsed=${gasUsed}`,
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
  public getTransferAmountSumForAccount(transactionRecord: TransactionRecord, accountId: string): number {
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
  public calculateTxRecordChargeAmount(exchangeRate: ExchangeRate): number {
    const exchangeRateInCents = exchangeRate.exchangeRateInCents;
    const hbarToTinybar = Hbar.from(1, HbarUnit.Hbar).toTinybars().toNumber();
    return Math.round((constants.NETWORK_FEES_IN_CENTS.TRANSACTION_GET_RECORD / exchangeRateInCents) * hbarToTinybar);
  }

  /**
   * Removes the '0x' prefix from a string if it exists.
   * @private
   * @param {string} input - The input string to be pruned.
   * @returns {string} The input string without the '0x' prefix.
   */
  private static prune0x(input: string): string {
    return input.startsWith('0x') ? input.substring(2) : input;
  }
}
