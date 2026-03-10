// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { FileId } from '@hashgraph/sdk';
import { Transaction as EthersTransaction } from 'ethers';
import EventEmitter from 'events';
import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import { formatTransactionIdWithoutQueryParams, numberTo0x, toHash32 } from '../../../../formatters';
import { Utils } from '../../../../utils';
import type { ICacheClient } from '../../../clients/cache/ICacheClient';
import { MirrorNodeClient } from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { SDKClientError } from '../../../errors/SDKClientError';
import { createTransactionFromContractResult, TransactionFactory } from '../../../factories/transactionFactory';
import {
  ISyntheticTransactionReceiptParams,
  TransactionReceiptFactory,
} from '../../../factories/transactionReceiptFactory';
import { Log, Transaction } from '../../../model';
import { Precheck } from '../../../precheck';
import {
  IContractResultsParams,
  ITransactionReceipt,
  LockAcquisitionResult,
  RequestDetails,
  TypedEvents,
} from '../../../types';
import HAPIService from '../../hapiService/hapiService';
import { ICommonService, LockService, TransactionPoolService } from '../../index';
import { ITransactionService } from './ITransactionService';

export class TransactionService implements ITransactionService {
  /**
   * The cache service used for caching responses.
   * @private
   * @readonly
   */
  private readonly cacheService: ICacheClient;

  /**
   * The common service providing shared functionality.
   * @private
   * @readonly
   */
  private readonly common: ICommonService;

  /**
   * The HAPI service for interacting with Hedera API.
   * @private
   * @readonly
   */
  private readonly hapiService: HAPIService;

  /**
   * The lock service for managing transaction ordering.
   * @private
   * @readonly
   */
  private readonly lockService: LockService;

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
   * Counter metric for tracking the total number of wrong nonce errors encountered.
   *
   * @private
   * @readonly
   */
  private readonly wrongNonceMetric: Counter;

  /**
   * The precheck class used for checking the fields like nonce before the tx execution.
   * @private
   */
  private readonly precheck: Precheck;

  /**
   * The service for handling the local transaction pool.
   * Responsible for storing, retrieving, and managing transactions before submission to the network.
   * @private
   * @readonly
   */
  private readonly transactionPoolService: TransactionPoolService;

  /**
   * The ID of the chain, as a hex string, as it would be returned in a JSON-RPC call.
   * @private
   */
  private readonly chain: string;

  /**
   * Constructor for the TransactionService class.
   */
  constructor(
    cacheService: ICacheClient,
    chain: string,
    common: ICommonService,
    private readonly eventEmitter: EventEmitter<TypedEvents>,
    hapiService: HAPIService,
    logger: Logger,
    mirrorNodeClient: MirrorNodeClient,
    transactionPoolService: TransactionPoolService,
    lockService: LockService,
    registry: Registry,
  ) {
    this.cacheService = cacheService;
    this.chain = chain;
    this.common = common;
    this.eventEmitter = eventEmitter;
    this.hapiService = hapiService;
    this.logger = logger;
    this.mirrorNodeClient = mirrorNodeClient;
    this.precheck = new Precheck(mirrorNodeClient, chain, transactionPoolService);
    this.transactionPoolService = transactionPoolService;
    this.lockService = lockService;

    const metricName = 'rpc_relay_wrong_nonce_errors_total';
    registry.removeSingleMetric(metricName);
    this.wrongNonceMetric = new Counter({
      name: metricName,
      help: 'Wrong nonce errors counter',
      labelNames: ['strategy'],
      registers: [registry],
    });
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
    try {
      return await this.getTransactionByBlockHashOrBlockNumAndIndex(
        { title: 'blockHash', value: blockHash },
        transactionIndex,
        requestDetails,
      );
    } catch (error) {
      throw this.common.genericErrorHandler(
        error,
        `Failed to retrieve contract result for blockHash ${blockHash} and index=${transactionIndex}`,
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
        `Failed to retrieve contract result for blockNum ${blockNum} and index=${transactionIndex}`,
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
    const contractResult = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResult.name,
      [hash, requestDetails],
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
        this.logger.trace(`no tx for %s`, hash);
        return null;
      }

      return TransactionFactory.createTransactionFromLog(this.chain, syntheticLogs[0], 0);
    }

    const fromAddress = await this.common.resolveEvmAddress(contractResult.from, requestDetails, [
      constants.TYPE_ACCOUNT,
    ]);
    const toAddress = contractResult.created_contract_ids.includes(contractResult.contract_id)
      ? null
      : await this.common.resolveEvmAddress(contractResult.to, requestDetails);
    contractResult.chain_id = contractResult.chain_id || this.chain;

    return createTransactionFromContractResult({
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
    const receiptResponse = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResult.name,
      [hash, requestDetails],
    );

    if (receiptResponse === null || receiptResponse.hash === undefined) {
      // handle synthetic transactions
      return await this.handleSyntheticTransactionReceipt(hash, requestDetails);
    } else {
      const receipt = await this.handleRegularTransactionReceipt(receiptResponse, requestDetails);
      this.logger.trace(`receipt for %s found in block %s`, hash, receipt.blockNumber);

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
    if (ConfigService.get('READ_ONLY')) {
      throw predefined.UNSUPPORTED_OPERATION('Relay is in read-only mode');
    }

    const transactionBuffer = Buffer.from(this.prune0x(transaction), 'hex');
    const parsedTx = Precheck.parseRawTransaction(transaction);

    // Validate and save the transaction to the transaction pool before submitting it to the network
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `Transaction undergoing basic properties (stateless) prechecks: transaction=%s`,
        JSON.stringify(parsedTx),
      );
    }
    this.precheck.validateBasicPropertiesStateless(parsedTx);
    await this.transactionPoolService.saveTransaction(parsedTx.from!, parsedTx);

    let lockResult: LockAcquisitionResult | undefined;
    let networkGasPriceInWeiBars: number;

    try {
      // Acquire lock before async operations
      // This ensures proper nonce ordering for transactions from the same sender
      if (parsedTx.from) {
        lockResult = await this.lockService.acquireLock(parsedTx.from);
      }
      networkGasPriceInWeiBars = Utils.addPercentageBufferToGasPrice(
        await this.common.getGasPriceInWeibars(requestDetails),
      );
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `Transaction undergoing account and network (stateful) prechecks: transaction=%s`,
          JSON.stringify(parsedTx),
        );
      }
      await this.precheck.validateAccountAndNetworkStateful(parsedTx, networkGasPriceInWeiBars, requestDetails);
    } catch (error) {
      // Release lock on any error during validation or prechecks
      if (lockResult) {
        await this.lockService.releaseLock(parsedTx.from!, lockResult.sessionKey, lockResult.acquiredAt);
      }
      await this.transactionPoolService.removeTransaction(`${parsedTx.from || ''}`, parsedTx.serialized);
      throw error;
    }

    /**
     * Note: If the USE_ASYNC_TX_PROCESSING feature flag is enabled,
     * the transaction hash is calculated and returned immediately after passing all prechecks.
     * All transaction processing logic is then handled asynchronously in the background.
     */
    const useAsyncTxProcessing = ConfigService.get('USE_ASYNC_TX_PROCESSING');
    if (useAsyncTxProcessing) {
      // Fire and forget - lock will be released after consensus submission
      this.sendRawTransactionProcessor(
        transactionBuffer,
        parsedTx,
        networkGasPriceInWeiBars,
        lockResult,
        requestDetails,
      );
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
      lockResult,
      requestDetails,
    );
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

    let currentNetworkExchangeRate = await this.cacheService.getAsync(cacheKey, callingMethod);

    if (!currentNetworkExchangeRate) {
      currentNetworkExchangeRate = (await this.mirrorNodeClient.getNetworkExchangeRate(requestDetails)).current_rate;
      await this.cacheService.set(cacheKey, currentNetworkExchangeRate, callingMethod, cacheTTL);
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
    );

    if (!contractResults[0]) {
      // Handle synthetic transactions (e.g., HAPI crypto transfers for tokens)
      return this.getSyntheticTransactionByBlockAndIndex(blockParam, transactionIndex, requestDetails);
    }

    const [resolvedToAddress, resolvedFromAddress] = await Promise.all([
      this.common.resolveEvmAddress(contractResults[0].to, requestDetails),
      this.common.resolveEvmAddress(contractResults[0].from, requestDetails, [constants.TYPE_ACCOUNT]),
    ]);

    return createTransactionFromContractResult({
      ...contractResults[0],
      from: resolvedFromAddress,
      to: resolvedToAddress,
    });
  }

  /**
   * Retrieves a synthetic transaction by block (hash or number) and transaction index.
   *
   * @param blockParam - The block identifier containing either blockHash or blockNumber
   * @param transactionIndex - The index of the transaction within the block (hex string)
   * @param requestDetails - Request details for logging and tracking
   * @returns A Transaction object if a synthetic transaction is found, null otherwise
   */
  private async getSyntheticTransactionByBlockAndIndex(
    blockParam: {
      title: 'blockHash' | 'blockNumber';
      value: string | number;
    },
    transactionIndex: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null> {
    const block = await this.mirrorNodeClient.getBlock(blockParam.value, requestDetails);

    if (!block) {
      this.logger.trace(`Block not found for %s=%s`, blockParam.title, blockParam.value);
      return null;
    }

    // Calculate slice count for parallel log retrieval based on block transaction count
    const sliceCount = Math.ceil(block.count / ConfigService.get('MIRROR_NODE_TIMESTAMP_SLICING_MAX_LOGS_PER_SLICE'));

    // Query logs within the block's timestamp range using timestamp slicing
    const syntheticLogs = await this.common.getLogsWithParams(
      null,
      {
        timestamp: [`gte:${block.timestamp.from}`, `lte:${block.timestamp.to}`],
      },
      requestDetails,
      sliceCount,
    );

    if (!syntheticLogs.length) {
      this.logger.trace(`No synthetic transactions found for block %s`, blockParam.value);
      return null;
    }

    // Find the log matching the specified transaction index
    const txIndexHex = numberTo0x(Number(transactionIndex));
    const matchingLog = syntheticLogs.find((log) => log.transactionIndex === txIndexHex);

    if (!matchingLog) {
      this.logger.trace(`No synthetic transaction found at index %s in block %s`, transactionIndex, blockParam.value);
      return null;
    }

    return TransactionFactory.createTransactionFromLog(this.chain, matchingLog, 0);
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
        blockTimestamp: numberTo0x(Number(receiptResponse.timestamp.split('.')[0])),
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

    let cumulativeGasUsed = 0;
    if (receiptResponse.transaction_index > 0) {
      const params: IContractResultsParams = {
        blockNumber: receiptResponse.block_number,
      };

      const blockContractResults = await this.mirrorNodeClient.getContractResults(requestDetails, params);

      if (Array.isArray(blockContractResults)) {
        for (const cr of blockContractResults) {
          if (Utils.isRejectedDueToHederaSpecificValidation(cr)) {
            continue;
          }

          if (cr.transaction_index == null || cr.gas_used == null) {
            continue;
          }

          // Only sum gas for transactions that come up to this one in the block (inclusive)
          if (cr.transaction_index <= receiptResponse.transaction_index) {
            cumulativeGasUsed += cr.gas_used;
          }
        }
      }
    } else {
      cumulativeGasUsed = receiptResponse.gas_used;
    }

    return TransactionReceiptFactory.createRegularReceipt({
      effectiveGas,
      from,
      logs,
      receiptResponse,
      to,
      cumulativeGasUsed,
    });
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
      this.logger.trace(`no receipt for %s`, hash);
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
      this.logger.trace(`receipt for %s found in block %s`, hash, receipt.blockNumber);
    }

    return receipt;
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
   * @param {LockAcquisitionResult | undefined} lockResult - The lock acquisition result containing session key and timestamp, undefined if no lock was acquired.
   * @param {RequestDetails} requestDetails - Details of the request for logging and tracking purposes.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash if successful, or a JsonRpcError if an error occurs.
   */
  async sendRawTransactionProcessor(
    transactionBuffer: Buffer,
    parsedTx: EthersTransaction,
    networkGasPriceInWeiBars: number,
    lockResult: LockAcquisitionResult | undefined,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const originalCallerAddress = parsedTx.from?.toString() || '';

    this.eventEmitter.emit('eth_execution', {
      method: constants.ETH_SEND_RAW_TRANSACTION,
    });

    const { submittedTransactionId, error } = await this.submitTransaction(
      transactionBuffer,
      originalCallerAddress,
      networkGasPriceInWeiBars,
      requestDetails,
    );

    if (lockResult) {
      await this.lockService.releaseLock(originalCallerAddress, lockResult.sessionKey, lockResult.acquiredAt);
    }
    // Remove the transaction from the transaction pool after submission
    await this.transactionPoolService.removeTransaction(originalCallerAddress, parsedTx.serialized);

    // Handle submission errors - throws for definitive failures, returns for MN polling cases
    await this.handleSubmissionError(error, parsedTx, requestDetails);

    // At this point, either no error or a post-execution failure that needs MN polling
    return this.getTransactionHashFromMirrorNode(submittedTransactionId, error, requestDetails);
  }

  /**
   * Handles transaction submission errors by classifying and routing them appropriately.
   *
   * This method serves as the single decision point for error handling after transaction submission.
   * It evaluates the error type and either throws immediately or returns to allow Mirror Node polling.
   *
   * Error handling flow:
   * 1. No error → return (proceed to MN polling for tx hash)
   * 2. Non-SDK error → throw as-is (application-level failure)
   * 3. SDK timeout error → throw as-is (network failure)
   * 4. Pre-execution failure (in HEDERA_SPECIFIC_REVERT_STATUSES):
   *    - WRONG_NONCE: fetch account nonce from MN
   *      - If nonce too high → throw NONCE_TOO_HIGH
   *      - If nonce too low → throw NONCE_TOO_LOW
   *      - If unable to determine → fallback to original status
   *    - Others: throws TRANSACTION_REJECTED with status details
   * 5. Post-execution failure → return (proceed to MN polling for tx hash)
   *
   * @param error - The error from transaction submission, or null/undefined if successful
   * @param parsedTx - The parsed transaction for nonce comparison (used for WRONG_NONCE handling)
   * @param requestDetails - Request details for logging and tracking
   * @throws {JsonRpcError} NONCE_TOO_HIGH or NONCE_TOO_LOW for wrong nonce errors
   * @throws {JsonRpcError} TRANSACTION_REJECTED for pre-execution failures
   * @throws {Error} Original error for non-SDK or timeout errors
   */
  private async handleSubmissionError(
    error: any,
    parsedTx: EthersTransaction,
    requestDetails: RequestDetails,
  ): Promise<void> {
    // No error - proceed to MN polling for transaction validation and txhash retrieval
    if (!error) {
      return;
    }

    // Non-SDK errors are definitive failures - propagate as-is
    if (!(error instanceof SDKClientError)) {
      throw error;
    }

    // Update metrics for SDK errors
    this.hapiService.decrementErrorCounter(error.statusCode);

    // SDK timeout errors - propagate as-is
    if (error.isTimeoutExceeded() || error.isConnectionDropped() || error.isGrpcTimeout()) {
      throw error;
    }

    // Check if this is a pre-execution failure
    const preExecutionFailures: string[] = ConfigService.get('HEDERA_SPECIFIC_REVERT_STATUSES');
    if (preExecutionFailures.includes(error.status.toString())) {
      // WRONG_NONCE requires special handling to determine if nonce is too high or too low
      // TODO: should be removed in https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/4860
      if (error.status.toString() === constants.TRANSACTION_RESULT_STATUS.WRONG_NONCE) {
        if (!ConfigService.get('ENABLE_NONCE_ORDERING')) {
          this.wrongNonceMetric.labels('none').inc();
        } else {
          this.wrongNonceMetric.labels(this.lockService.getStrategyType()).inc();
        }
        let accountNonce: number | null = null;
        try {
          accountNonce = (await this.mirrorNodeClient.getAccount(parsedTx.from!, requestDetails))?.ethereum_nonce;
        } catch (mirrorNodeError) {
          // Mirror Node request failed (e.g., 404, 429, 5xx)
          // Simply ignore and fallback to the original rejection to avoid masking the true error
          this.logger.debug(mirrorNodeError, `Failed to fetch account nonce for WRONG_NONCE error handling`);
        }

        // Determine if nonce is too high or too low
        if (accountNonce != null && accountNonce !== parsedTx.nonce) {
          if (parsedTx.nonce > accountNonce) {
            throw predefined.NONCE_TOO_HIGH(parsedTx.nonce, accountNonce);
          } else {
            throw predefined.NONCE_TOO_LOW(parsedTx.nonce, accountNonce);
          }
        }
      }

      // All other pre-execution failures throw TRANSACTION_REJECTED (-32003)
      throw predefined.TRANSACTION_REJECTED(error.status.toString(), error.message);
    }

    // Post-execution failure (e.g. CONTRACT_REVERT_EXECUTED, INVALID_ALIAS_KEY, etc.)
    // proceed to allow MN polling for transaction hash
    return;
  }

  /**
   * Retrieves the transaction hash from Mirror Node after transaction submission.
   *
   * This method is called when a transaction has a valid transaction ID and either:
   * - Succeeded without error
   * - Failed with a post-execution error (transaction executed at consensus but reverted)
   *
   * If the Mirror Node cannot find the transaction record:
   * - If there is any unknown SDK errors, propagate to preserve the original failure context
   * - If there is no error, throw INTERNAL_ERROR because the transaction should exist after successful submission
   *
   * @param submittedTransactionId - The transaction ID to query
   * @param submissionError - Original submission error
   * @param requestDetails - Request details for logging and tracking
   * @returns The transaction hash
   * @throws {SDKClientError} Throws original SDK error when MN record not found and if submissionError exists
   * @throws {JsonRpcError} Throws INTERNAL_ERROR when MN record unexpectedly missing after successful submission
   */
  private async getTransactionHashFromMirrorNode(
    submittedTransactionId: string,
    submissionError: any,
    requestDetails: RequestDetails,
  ): Promise<string> {
    const formattedTransactionId = formatTransactionIdWithoutQueryParams(submittedTransactionId);

    const contractResult = await this.mirrorNodeClient.repeatedRequest(
      this.mirrorNodeClient.getContractResult.name,
      [formattedTransactionId, { ...requestDetails, ipAddress: constants.MASKED_IP_ADDRESS }],
      this.mirrorNodeClient.getMirrorNodeRequestRetryCount(),
    );

    // If contract result exists and has a hash, it's a successful case
    if (contractResult && contractResult.hash != null) {
      return contractResult.hash;
    }

    // Contract result not found on Mirror Node
    // If there's any unknown SDK errors, propagate to preserve the original failure context
    if (submissionError) {
      throw submissionError;
    }

    // Otherwise, throw INTERNAL_ERROR as the transaction should exist but doesn't
    throw predefined.INTERNAL_ERROR(
      `Transaction submitted but record unavailable: transactionId=${submittedTransactionId}`,
    );
  }

  /**
   * Submits a transaction to the network
   * @param transactionBuffer The raw transaction buffer
   * @param originalCallerAddress The address of the original caller
   * @param networkGasPriceInWeiBars The current network gas price in wei bars
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<{submittedTransactionId: string, error: any}>} A promise that resolves to an object containing transaction submission details
   */
  private async submitTransaction(
    transactionBuffer: Buffer,
    originalCallerAddress: string,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<{
    submittedTransactionId: string;
    error: any;
  }> {
    let fileId: FileId | null = null;
    let submittedTransactionId = '';
    let error = null;

    try {
      const sendRawTransactionResult = await this.hapiService.submitEthereumTransaction(
        transactionBuffer,
        constants.ETH_SEND_RAW_TRANSACTION,
        requestDetails,
        originalCallerAddress,
        networkGasPriceInWeiBars,
        await this.getCurrentNetworkExchangeRateInCents(requestDetails),
      );

      fileId = sendRawTransactionResult.fileId;
      submittedTransactionId = sendRawTransactionResult.txResponse.transactionId?.toString();
      if (!constants.TRANSACTION_ID_REGEX.test(submittedTransactionId)) {
        throw predefined.INTERNAL_ERROR(
          `Transaction successfully submitted but returned invalid transactionID: transactionId==${submittedTransactionId}`,
        );
      }
    } catch (e: any) {
      if (e instanceof SDKClientError) {
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
          .deleteFile(fileId, requestDetails, constants.ETH_SEND_RAW_TRANSACTION, originalCallerAddress)
          .then();
      }
    }

    return { submittedTransactionId, error };
  }
}
