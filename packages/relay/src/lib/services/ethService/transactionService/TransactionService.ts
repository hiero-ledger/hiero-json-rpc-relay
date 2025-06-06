// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { FileId } from '@hashgraph/sdk';
import { Transaction as EthersTransaction } from 'ethers';
import EventEmitter from 'events';
import { Logger } from 'pino';

import { formatTransactionIdWithoutQueryParams } from '../../../../formatters';
import { numberTo0x, toHash32 } from '../../../../formatters';
import { Utils } from '../../../../utils';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { SDKClientError } from '../../../errors/SDKClientError';
import { TransactionFactory } from '../../../factories/transactionFactory';
import {
  IRegularTransactionReceiptParams,
  ISyntheticTransactionReceiptParams,
  TransactionReceiptFactory,
} from '../../../factories/transactionReceiptFactory';
import { Log, Transaction } from '../../../model';
import { Precheck } from '../../../precheck';
import { ITransactionReceipt, RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import HAPIService from '../../hapiService/hapiService';
import { CommonService, ICommonService } from '../../index';
import { ITransactionService } from './ITransactionService';

export class TransactionService implements ITransactionService {
  /**
   * The cache service used for caching responses.
   * @private
   * @readonly
   */
  private readonly cacheService: CacheService;

  /**
   * The common service providing shared functionality.
   * @private
   * @readonly
   */
  private readonly common: ICommonService;

  /**
   * An instance of EventEmitter used for emitting and handling events within the class.
   *
   * @private
   * @readonly
   * @type {EventEmitter}
   */
  private readonly eventEmitter: EventEmitter;

  /**
   * The HAPI service for interacting with Hedera API.
   * @private
   * @readonly
   */
  private readonly hapiService: HAPIService;

  /**
   * Logger instance for logging messages.
   * @private
   * @readonly
   */
  private readonly logger: Logger;

  /**
   * The mirror node client for interacting with the Hedera mirror node.
   * @private
   * @readonly
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * The precheck class used for checking the fields like nonce before the tx execution.
   * @private
   */
  private readonly precheck: Precheck;

  /**
   * The ID of the chain, as a hex string, as it would be returned in a JSON-RPC call.
   * @private
   */
  private readonly chain: string;

  /**
   * Constructor for the TransactionService class.
   */
  constructor(
    cacheService: CacheService,
    chain: string,
    common: ICommonService,
    eventEmitter: EventEmitter,
    hapiService: HAPIService,
    logger: Logger,
    mirrorNodeClient: MirrorNodeClient,
  ) {
    this.cacheService = cacheService;
    this.chain = chain;
    this.common = common;
    this.eventEmitter = eventEmitter;
    this.hapiService = hapiService;
    this.logger = logger;
    this.mirrorNodeClient = mirrorNodeClient;
    this.precheck = new Precheck(mirrorNodeClient, logger, chain);
  }

  /**
   * Gets a transaction by block hash and transaction index
   * @param blockHash The block hash
   * @param transactionIndex The transaction index
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<Transaction | null>} A promise that resolves to a Transaction object or null if not found
   */
  async getTransactionByBlockHashAndIndex(
    blockHash: string,
    transactionIndex: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getTransactionByBlockHashAndIndex(hash=${blockHash}, index=${transactionIndex})`,
      );
    }

    try {
      return await this.getTransactionByBlockHashOrBlockNumAndIndex(
        { title: 'blockHash', value: blockHash },
        transactionIndex,
        requestDetails,
      );
    } catch (error) {
      throw this.common.genericErrorHandler(
        error,
        `${requestIdPrefix} Failed to retrieve contract result for blockHash ${blockHash} and index=${transactionIndex}`,
      );
    }
  }

  /**
   * Gets a transaction by block number and transaction index
   * @param blockNumOrTag The block number
   * @param transactionIndex The transaction index
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<Transaction | null>} A promise that resolves to a Transaction object or null if not found
   */
  async getTransactionByBlockNumberAndIndex(
    blockNumOrTag: string,
    transactionIndex: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getTransactionByBlockNumberAndIndex(blockNum=${blockNumOrTag}, index=${transactionIndex})`,
      );
    }
    const blockNum = await this.common.translateBlockTag(blockNumOrTag, requestDetails);

    try {
      return await this.getTransactionByBlockHashOrBlockNumAndIndex(
        { title: 'blockNumber', value: blockNum },
        transactionIndex,
        requestDetails,
      );
    } catch (error) {
      throw this.common.genericErrorHandler(
        error,
        `${requestIdPrefix} Failed to retrieve contract result for blockNum ${blockNum} and index=${transactionIndex}`,
      );
    }
  }

  /**
   * Gets a transaction by hash
   * @param hash The transaction hash
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<Transaction | null>} A promise that resolves to a Transaction object or null if not found
   */
  async getTransactionByHash(hash: string, requestDetails: RequestDetails): Promise<Transaction | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getTransactionByHash(hash=${hash})`, hash);
    }

    const contractResult = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResult.name,
      [hash, requestDetails],
      requestDetails,
    );

    if (contractResult === null || contractResult.hash === undefined) {
      // handle synthetic transactions
      const syntheticLogs = await this.common.getLogsWithParams(
        null,
        {
          'transaction.hash': hash,
        },
        requestDetails,
      );

      // no tx found
      if (!syntheticLogs.length) {
        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(`${requestIdPrefix} no tx for ${hash}`);
        }
        return null;
      }

      return TransactionFactory.createTransactionFromLog(this.chain, syntheticLogs[0]);
    }

    const fromAddress = await this.common.resolveEvmAddress(contractResult.from, requestDetails, [
      constants.TYPE_ACCOUNT,
    ]);
    const toAddress = await this.common.resolveEvmAddress(contractResult.to, requestDetails);
    contractResult.chain_id = contractResult.chain_id || this.chain;

    return CommonService.formatContractResult({
      ...contractResult,
      from: fromAddress,
      to: toAddress,
    });
  }

  /**
   * Gets a transaction receipt by hash
   * @param hash The transaction hash
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<ITransactionReceipt | null>} A promise that resolves to a transaction receipt or null if not found
   */
  async getTransactionReceipt(hash: string, requestDetails: RequestDetails): Promise<ITransactionReceipt | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getTransactionReceipt(${hash})`);
    }

    const receiptResponse = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResult.name,
      [hash, requestDetails],
      requestDetails,
    );

    if (receiptResponse === null || receiptResponse.hash === undefined) {
      // handle synthetic transactions
      return await this.handleSyntheticTransactionReceipt(hash, requestDetails);
    } else {
      const receipt = await this.handleRegularTransactionReceipt(receiptResponse, requestDetails);
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestIdPrefix} receipt for ${hash} found in block ${receipt.blockNumber}`);
      }

      return receipt;
    }
  }

  /**
   * Sends a raw transaction
   * @param transaction The raw transaction data
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash or a JsonRpcError if an error occurs
   */
  async sendRawTransaction(transaction: string, requestDetails: RequestDetails): Promise<string | JsonRpcError> {
    const transactionBuffer = Buffer.from(this.prune0x(transaction), 'hex');
    const parsedTx = Precheck.parseRawTransaction(transaction);
    const networkGasPriceInWeiBars = Utils.addPercentageBufferToGasPrice(
      await this.common.getGasPriceInWeibars(requestDetails),
    );

    await this.validateRawTransaction(parsedTx, networkGasPriceInWeiBars, requestDetails);

    /**
     * Note: If the USE_ASYNC_TX_PROCESSING feature flag is enabled,
     * the transaction hash is calculated and returned immediately after passing all prechecks.
     * All transaction processing logic is then handled asynchronously in the background.
     */
    const useAsyncTxProcessing = ConfigService.get('USE_ASYNC_TX_PROCESSING');
    if (useAsyncTxProcessing) {
      this.sendRawTransactionProcessor(transactionBuffer, parsedTx, networkGasPriceInWeiBars, requestDetails);
      return Utils.computeTransactionHash(transactionBuffer);
    }

    /**
     * Note: If the USE_ASYNC_TX_PROCESSING feature flag is disabled,
     * wait for all transaction processing logic to complete before returning the transaction hash.
     */
    return await this.sendRawTransactionProcessor(
      transactionBuffer,
      parsedTx,
      networkGasPriceInWeiBars,
      requestDetails,
    );
  }

  /**
   * Send transaction - not supported
   * @param requestDetails The request details for logging and tracking
   * @returns {JsonRpcError} A JsonRpcError indicating that the method is not supported
   */
  public sendTransaction(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} sendTransaction()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Sign transaction - not supported
   * @param requestDetails The request details for logging and tracking
   * @returns {JsonRpcError} A JsonRpcError indicating that the method is not supported
   */
  public signTransaction(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} signTransaction()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Sign - not supported
   * @param requestDetails The request details for logging and tracking
   * @returns {JsonRpcError} A JsonRpcError indicating that the method is not supported
   */
  public sign(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} sign()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Emits an Ethereum execution event with transaction details
   * @param parsedTx The parsed transaction object
   * @param originalCallerAddress The address of the original caller
   * @param toAddress The destination address
   * @param requestDetails The request details for logging and tracking
   */
  private emitEthExecutionEvent(
    parsedTx: EthersTransaction,
    originalCallerAddress: string,
    toAddress: string,
    requestDetails: RequestDetails,
  ): void {
    this.eventEmitter.emit(constants.EVENTS.ETH_EXECUTION, {
      method: constants.ETH_SEND_RAW_TRANSACTION,
      functionSelector: parsedTx.data?.substring(0, constants.FUNCTION_SELECTOR_CHAR_LENGTH) || '',
      from: originalCallerAddress,
      to: toAddress,
      requestDetails: requestDetails,
    });
  }

  /**
   * Retrieves the current network exchange rate of HBAR to USD in cents.
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<number>} A promise that resolves to the current exchange rate in cents
   */
  private async getCurrentNetworkExchangeRateInCents(requestDetails: RequestDetails): Promise<number> {
    const cacheKey = constants.CACHE_KEY.CURRENT_NETWORK_EXCHANGE_RATE;
    const callingMethod = this.getCurrentNetworkExchangeRateInCents.name;
    const cacheTTL = 15 * 60 * 1000; // 15 minutes

    let currentNetworkExchangeRate = await this.cacheService.getAsync(cacheKey, callingMethod, requestDetails);

    if (!currentNetworkExchangeRate) {
      currentNetworkExchangeRate = (await this.mirrorNodeClient.getNetworkExchangeRate(requestDetails)).current_rate;
      await this.cacheService.set(cacheKey, currentNetworkExchangeRate, callingMethod, requestDetails, cacheTTL);
    }

    const exchangeRateInCents = currentNetworkExchangeRate.cent_equivalent / currentNetworkExchangeRate.hbar_equivalent;
    return exchangeRateInCents;
  }

  /**
   * Gets a transaction by block hash or block number and transaction index
   * @param blockParam The block parameter (hash or number)
   * @param transactionIndex The transaction index
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<Transaction | null>} A promise that resolves to a Transaction object or null if not found
   */
  private async getTransactionByBlockHashOrBlockNumAndIndex(
    blockParam: {
      title: 'blockHash' | 'blockNumber';
      value: string | number;
    },
    transactionIndex: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null> {
    const contractResults = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResults.name,
      [
        requestDetails,
        {
          [blockParam.title]: blockParam.value,
          transactionIndex: Number(transactionIndex),
        },
        undefined,
      ],
      requestDetails,
    );

    if (!contractResults[0]) return null;

    const [resolvedToAddress, resolvedFromAddress] = await Promise.all([
      this.common.resolveEvmAddress(contractResults[0].to, requestDetails),
      this.common.resolveEvmAddress(contractResults[0].from, requestDetails, [constants.TYPE_ACCOUNT]),
    ]);

    return CommonService.formatContractResult({
      ...contractResults[0],
      from: resolvedFromAddress,
      to: resolvedToAddress,
    });
  }

  /**
   * Handles the processing of a regular transaction receipt
   * @param receiptResponse The receipt response from the mirror node
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<ITransactionReceipt>} A promise that resolves to a transaction receipt
   */
  private async handleRegularTransactionReceipt(
    receiptResponse: any,
    requestDetails: RequestDetails,
  ): Promise<ITransactionReceipt> {
    const effectiveGas = await this.common.getCurrentGasPriceForBlock(receiptResponse.block_hash, requestDetails);
    // support stricter go-eth client which requires the transaction hash property on logs
    const logs = receiptResponse.logs.map((log) => {
      return new Log({
        address: log.address,
        blockHash: toHash32(receiptResponse.block_hash),
        blockNumber: numberTo0x(receiptResponse.block_number),
        data: log.data,
        logIndex: numberTo0x(log.index),
        removed: false,
        topics: log.topics,
        transactionHash: toHash32(receiptResponse.hash),
        transactionIndex: numberTo0x(receiptResponse.transaction_index),
      });
    });
    const [from, to] = await Promise.all([
      this.common.resolveEvmAddress(receiptResponse.from, requestDetails),
      this.common.resolveEvmAddress(receiptResponse.to, requestDetails),
    ]);
    if (!from) {
      throw predefined.INTERNAL_ERROR(`Could not resolve from address for transaction ${receiptResponse.hash}`);
    }
    const transactionReceiptParams: IRegularTransactionReceiptParams = {
      effectiveGas,
      from,
      logs,
      receiptResponse,
      to,
    };
    const receipt: ITransactionReceipt = TransactionReceiptFactory.createRegularReceipt(transactionReceiptParams);

    return receipt;
  }

  /**
   * Handles the processing of a synthetic transaction receipt
   * @param hash The transaction hash
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<ITransactionReceipt | null>} A promise that resolves to a transaction receipt or null if not found
   */
  private async handleSyntheticTransactionReceipt(
    hash: string,
    requestDetails: RequestDetails,
  ): Promise<ITransactionReceipt | null> {
    const syntheticLogs = await this.common.getLogsWithParams(
      null,
      {
        'transaction.hash': hash,
      },
      requestDetails,
    );

    // no tx found
    if (!syntheticLogs.length) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestDetails.formattedRequestId} no receipt for ${hash}`);
      }
      return null;
    }

    const gasPriceForTimestamp = await this.common.getCurrentGasPriceForBlock(
      syntheticLogs[0].blockHash,
      requestDetails,
    );

    const params: ISyntheticTransactionReceiptParams = {
      syntheticLogs,
      gasPriceForTimestamp,
    };
    const receipt: ITransactionReceipt = TransactionReceiptFactory.createSyntheticReceipt(params);

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} receipt for ${hash} found in block ${receipt.blockNumber}`,
      );
    }

    return receipt;
  }

  /**
   * Validates a parsed transaction by performing prechecks
   * @param parsedTx The parsed Ethereum transaction to validate
   * @param networkGasPriceInWeiBars The current network gas price in wei bars
   * @param requestDetails The request details for logging and tracking
   * @throws {JsonRpcError} If validation fails
   */
  private async validateRawTransaction(
    parsedTx: EthersTransaction,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<void> {
    try {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} Transaction undergoing prechecks: transaction=${JSON.stringify(
            parsedTx,
          )}`,
        );
      }

      await this.precheck.sendRawTransactionCheck(parsedTx, networkGasPriceInWeiBars, requestDetails);
    } catch (e: any) {
      this.logger.error(
        `${requestDetails.formattedRequestId} Precheck failed: transaction=${JSON.stringify(parsedTx)}`,
      );
      throw this.common.genericErrorHandler(e);
    }
  }

  /**
   * Removes the '0x' prefix from a string if present
   * @param input The input string
   * @returns {string} The input string without the '0x' prefix
   */
  private prune0x(input: string): string {
    return input.startsWith(constants.EMPTY_HEX) ? input.substring(2) : input;
  }

  /**
   * Asynchronously processes a raw transaction by submitting it to the network, managing HFS, polling the MN, handling errors, and returning the transaction hash.
   *
   * @async
   * @param {Buffer} transactionBuffer - The raw transaction data as a buffer.
   * @param {EthersTransaction} parsedTx - The parsed Ethereum transaction object.
   * @param {number} networkGasPriceInWeiBars - The current network gas price in wei bars.
   * @param {RequestDetails} requestDetails - Details of the request for logging and tracking purposes.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash if successful, or a JsonRpcError if an error occurs.
   */
  async sendRawTransactionProcessor(
    transactionBuffer: Buffer,
    parsedTx: EthersTransaction,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    let sendRawTransactionError: any;

    const requestIdPrefix = requestDetails.formattedRequestId;
    const originalCallerAddress = parsedTx.from?.toString() || '';
    const toAddress = parsedTx.to?.toString() || '';

    this.emitEthExecutionEvent(parsedTx, originalCallerAddress, toAddress, requestDetails);

    const { txSubmitted, submittedTransactionId, error } = await this.submitTransaction(
      transactionBuffer,
      originalCallerAddress,
      networkGasPriceInWeiBars,
      requestDetails,
    );

    sendRawTransactionError = error;

    // After the try-catch process above, the `submittedTransactionId` is potentially valid in only two scenarios:
    //   - The transaction was successfully submitted and fully processed by CN and MN.
    //   - The transaction encountered "SDK timeout exceeded" or "Connection Dropped" errors from the SDK but still potentially reached the consensus level.
    // In both scenarios, polling the MN is required to verify the transaction's validity before return the transaction hash to clients.
    if (submittedTransactionId) {
      try {
        const formattedTransactionId = formatTransactionIdWithoutQueryParams(submittedTransactionId);

        // Create a modified copy of requestDetails
        const modifiedRequestDetails = {
          ...requestDetails,
          ipAddress: constants.MASKED_IP_ADDRESS,
        };

        const contractResult = await this.mirrorNodeClient.repeatedRequest(
          this.mirrorNodeClient.getContractResult.name,
          [formattedTransactionId, modifiedRequestDetails],
          this.mirrorNodeClient.getMirrorNodeRequestRetryCount(),
          requestDetails,
        );

        if (!contractResult) {
          if (
            sendRawTransactionError instanceof SDKClientError &&
            (sendRawTransactionError.isConnectionDropped() || sendRawTransactionError.isTimeoutExceeded())
          ) {
            throw sendRawTransactionError;
          }

          this.logger.warn(
            `${requestIdPrefix} No matching transaction record retrieved: transactionId=${submittedTransactionId}`,
          );

          throw predefined.INTERNAL_ERROR(
            `No matching transaction record retrieved: transactionId=${submittedTransactionId}`,
          );
        }

        if (contractResult.hash == null) {
          this.logger.error(
            `${requestIdPrefix} Transaction returned a null transaction hash: transactionId=${submittedTransactionId}`,
          );
          throw predefined.INTERNAL_ERROR(
            `Transaction returned a null transaction hash: transactionId=${submittedTransactionId}`,
          );
        }

        return contractResult.hash;
      } catch (e: any) {
        sendRawTransactionError = e;
      }
    }

    // If this point is reached, it means that no valid transaction hash was returned. Therefore, an error must have occurred.
    return await this.sendRawTransactionErrorHandler(
      sendRawTransactionError,
      transactionBuffer,
      txSubmitted,
      parsedTx,
      requestDetails,
    );
  }

  /**
   * Handles errors that occur during raw transaction processing
   * @param e The error that occurred
   * @param transactionBuffer The raw transaction buffer
   * @param txSubmitted Whether the transaction was submitted
   * @param parsedTx The parsed transaction
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash or a JsonRpcError
   */
  private async sendRawTransactionErrorHandler(
    e: any,
    transactionBuffer: Buffer,
    txSubmitted: boolean,
    parsedTx: EthersTransaction,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    this.logger.error(
      e,
      `${
        requestDetails.formattedRequestId
      } Failed to successfully submit sendRawTransaction: transaction=${JSON.stringify(parsedTx)}`,
    );
    if (e instanceof JsonRpcError) {
      return e;
    }

    if (e instanceof SDKClientError) {
      if (e.nodeAccountId) {
        // Log the target node account ID, right now, it's populated only for MaxAttemptsOrTimeout error
        this.logger.info(
          `${requestDetails.formattedRequestId} Transaction failed to execute against node with id: ${e.nodeAccountId}`,
        );
      }

      this.hapiService.decrementErrorCounter(e.statusCode);
      if (e.status.toString() === constants.TRANSACTION_RESULT_STATUS.WRONG_NONCE) {
        const mirrorNodeGetContractResultRetries = this.mirrorNodeClient.getMirrorNodeRequestRetryCount();

        // note: because this is a WRONG_NONCE error handler, the nonce of the account is expected to be different from the nonce of the parsedTx
        //       running a polling loop to give mirror node enough time to update account nonce
        let accountNonce: number | null = null;
        for (let i = 0; i < mirrorNodeGetContractResultRetries; i++) {
          const accountInfo = await this.mirrorNodeClient.getAccount(parsedTx.from!, requestDetails);
          if (accountInfo.ethereum_nonce !== parsedTx.nonce) {
            accountNonce = accountInfo.ethereum_nonce;
            break;
          }

          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(
              `${
                requestDetails.formattedRequestId
              } Repeating retry to poll for updated account nonce. Count ${i} of ${mirrorNodeGetContractResultRetries}. Waiting ${this.mirrorNodeClient.getMirrorNodeRetryDelay()} ms before initiating a new request`,
            );
          }
          await new Promise((r) => setTimeout(r, this.mirrorNodeClient.getMirrorNodeRetryDelay()));
        }

        if (!accountNonce) {
          this.logger.warn(`${requestDetails.formattedRequestId} Cannot find updated account nonce.`);
          throw predefined.INTERNAL_ERROR(`Cannot find updated account nonce for WRONG_NONCE error.`);
        }

        if (parsedTx.nonce > accountNonce) {
          return predefined.NONCE_TOO_HIGH(parsedTx.nonce, accountNonce);
        } else {
          return predefined.NONCE_TOO_LOW(parsedTx.nonce, accountNonce);
        }
      }
    }

    if (!txSubmitted) {
      return predefined.INTERNAL_ERROR(e.message.toString());
    }

    await this.mirrorNodeClient.getContractRevertReasonFromTransaction(e, requestDetails);

    this.logger.error(
      e,
      `${
        requestDetails.formattedRequestId
      } Failed sendRawTransaction during record retrieval for transaction, returning computed hash: transaction=${JSON.stringify(
        parsedTx,
      )}`,
    );
    //Return computed hash if unable to retrieve EthereumHash from record due to error
    return Utils.computeTransactionHash(transactionBuffer);
  }

  /**
   * Submits a transaction to the network
   * @param transactionBuffer The raw transaction buffer
   * @param originalCallerAddress The address of the original caller
   * @param networkGasPriceInWeiBars The current network gas price in wei bars
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<{txSubmitted: boolean, submittedTransactionId: string, error: any}>} A promise that resolves to an object containing transaction submission details
   */
  private async submitTransaction(
    transactionBuffer: Buffer,
    originalCallerAddress: string,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<{
    txSubmitted: boolean;
    submittedTransactionId: string;
    error: any;
  }> {
    let fileId: FileId | null = null;
    let txSubmitted = false;
    let submittedTransactionId = '';
    let error = null;

    try {
      const sendRawTransactionResult = await this.hapiService
        .getSDKClient()
        .submitEthereumTransaction(
          transactionBuffer,
          constants.ETH_SEND_RAW_TRANSACTION,
          requestDetails,
          originalCallerAddress,
          networkGasPriceInWeiBars,
          await this.getCurrentNetworkExchangeRateInCents(requestDetails),
        );

      txSubmitted = true;
      fileId = sendRawTransactionResult.fileId;
      submittedTransactionId = sendRawTransactionResult.txResponse.transactionId?.toString();
      if (!constants.TRANSACTION_ID_REGEX.test(submittedTransactionId)) {
        throw predefined.INTERNAL_ERROR(
          `Transaction successfully submitted but returned invalid transactionID: transactionId==${submittedTransactionId}`,
        );
      }
    } catch (e: any) {
      if (e instanceof SDKClientError && (e.isConnectionDropped() || e.isTimeoutExceeded())) {
        submittedTransactionId = e.transactionId || '';
      }

      error = e;
    } finally {
      /**
       *  For transactions of type CONTRACT_CREATE, if the contract's bytecode (calldata) exceeds 5120 bytes, HFS is employed to temporarily store the bytecode on the network.
       *  After transaction execution, whether successful or not, any entity associated with the 'fileId' should be removed from the Hedera network.
       */
      if (fileId) {
        this.hapiService
          .getSDKClient()
          .deleteFile(
            fileId,
            requestDetails,
            constants.ETH_SEND_RAW_TRANSACTION,
            fileId.toString(),
            originalCallerAddress,
          )
          .then();
      }
    }

    return { txSubmitted, submittedTransactionId, error };
  }
}
