// SPDX-License-Identifier: Apache-2.0
import { type FileId } from '@hiero-ledger/sdk';
import { type Transaction as EthersTransaction } from 'ethers/transaction';
import type EventEmitter from 'events';
import { type Logger } from 'pino';
import { Counter, type Registry } from 'prom-client';

import { ConfigService } from '../../../../../config-service/services';
import { nanOrNumberTo0x, numberTo0x, toHash32 } from '../../../../formatters';
import { Utils } from '../../../../utils';
import type { ICacheClient } from '../../../clients/cache/ICacheClient';
import {
  isChildContractRecord,
  isImmatureContractRecord,
  type MirrorNodeClient,
} from '../../../clients/mirrorNodeClient';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { SDKClientError } from '../../../errors/SDKClientError';
import { createTransactionFromContractResult, TransactionFactory } from '../../../factories/transactionFactory';
import {
  type ISyntheticTransactionReceiptParams,
  TransactionReceiptFactory,
} from '../../../factories/transactionReceiptFactory';
import { Log, type Transaction } from '../../../model';
import { Precheck } from '../../../precheck';
import type {
  IAccountBalance,
  IContractResultsParams,
  ITransactionReceipt,
  LockAcquisitionResult,
  MirrorNodeContractResult,
  MirrorNodeContractResultDetails,
  RequestDetails,
  TypedEvents,
} from '../../../types';
import type HAPIService from '../../hapiService/hapiService';
import type {
  IAccountService,
  ICommonService,
  LockService,
  TransactionPoolService,
  TransactionTracingService,
} from '../../index';
import type { ITransactionService } from './ITransactionService';

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
   * Records each submitted transaction's lifecycle for status tracing; no-op when TX_STATUS_TRACING is off.
   * @private
   * @readonly
   */
  private readonly transactionTracingService: TransactionTracingService;

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
    private readonly accountService: IAccountService,
    private readonly eventEmitter: EventEmitter<TypedEvents>,
    hapiService: HAPIService,
    logger: Logger,
    mirrorNodeClient: MirrorNodeClient,
    transactionPoolService: TransactionPoolService,
    lockService: LockService,
    registry: Registry,
    transactionTracingService: TransactionTracingService,
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
    this.transactionTracingService = transactionTracingService;
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
    const contractResult =
      await this.mirrorNodeClient.getContractResultWithRetry<MirrorNodeContractResultDetails | null>(
        this.mirrorNodeClient.getContractResult.name,
        [hash, requestDetails],
        { returnImmatureRecords: true },
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

    // A record still immature after the full polling window belongs to a transaction rejected before
    // execution: it will never be part of a block. Filter it out rather than serve a transaction whose
    // block fields can never be filled in - `eth_getTransactionReceipt` carries the rejection detail.
    if (isImmatureContractRecord(contractResult)) {
      this.logger.trace(`immature (rejected) contract result filtered out for %s`, hash);
      return null;
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
      from: fromAddress!,
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
    const receiptResponse =
      await this.mirrorNodeClient.getContractResultWithRetry<MirrorNodeContractResultDetails | null>(
        this.mirrorNodeClient.getContractResult.name,
        [hash, requestDetails],
        { returnImmatureRecords: true },
      );

    if (receiptResponse === null || receiptResponse.hash === undefined) {
      // handle synthetic transactions
      const syntheticReceipt = await this.handleSyntheticTransactionReceipt(hash, requestDetails);
      if (syntheticReceipt) {
        return syntheticReceipt;
      }

      // Mirror Node has nothing for this hash. When tracing is enabled, consult the store: a recorded
      // rejected/timedout outcome surfaces as a -32003 error instead of an indistinguishable null.
      const fallbackError = await this.transactionTracingService.getReceiptFallbackError(hash);
      if (fallbackError) {
        throw fallbackError;
      }

      return null;
    } else {
      // A record still immature after the full polling window belongs to a transaction rejected before
      // execution: no block linkage will ever be filled in, so no receipt can be built. Surface the
      // rejection with its details instead of a half-populated receipt.
      if (isImmatureContractRecord(receiptResponse)) {
        // A child record lacks an index too, but it is no rejection: it is not an ethereum
        // transaction at all, so it has no receipt of its own. Report it as not found, the way
        // `eth_getTransactionByHash` already does for the same record.
        if (isChildContractRecord(receiptResponse)) {
          this.logger.trace(`child (synthetic) record has no receipt of its own for %s`, hash);
          return null;
        }

        throw await this.buildRejectedRecordError(hash, receiptResponse);
      }

      // Mirror Node reflected a receipt - upgrade any traced record to validated (admin-inspection only).
      // Fire-and-forget so receipt latency isn't coupled to the tracing store.
      void this.transactionTracingService.recordValidated(hash);

      const receipt = await this.handleRegularTransactionReceipt(receiptResponse, requestDetails);
      this.logger.trace(`receipt for %s found in block %s`, hash, receipt.blockNumber);

      return receipt;
    }
  }

  /**
   * Builds the `-32003` error for a transaction the Mirror Node reflects as a permanently immature record,
   * i.e. one rejected before execution. The Mirror Node record is authoritative for the Hedera status
   * (`result`) and failure detail (`error_message`); a traced record, when the relay submitted the
   * transaction itself, fills in whatever the record leaves blank plus the Hedera transaction id.
   *
   * @param hash The transaction hash
   * @param record The immature contract result returned by the Mirror Node
   * @returns {Promise<JsonRpcError>} A promise that resolves to the `-32003` rejection error
   */
  private async buildRejectedRecordError(hash: string, record: MirrorNodeContractResultDetails): Promise<JsonRpcError> {
    const txHash = hash.toLowerCase();
    const traced = await this.transactionTracingService.getByHash(hash);

    return predefined.TRANSACTION_REJECTED_DETAILED({
      txHash,
      hederaStatus: record.result || traced?.hederaStatus,
      detail:
        record.error_message ||
        traced?.error ||
        'The transaction was rejected before execution and will never be included in a block.',
      transactionId: traced?.transactionId,
    });
  }

  /**
   * Sends a raw transaction: 2-lock sendRawTransaction
   *
   * FLOW:
   *   1. stateless precheck
   *   2. acquire Lock 1 (ingress lock)
   *      a. read senderLocalNonce cache
   *         warm  → in-mem nonce check vs cache.value
   *                 cache := { value: cache.value + 1, version: cache.version }
   *                 tx.admittedVersion := cache.version
   *         cold  → verifyAccount (MN) + getPendingCount → nonce check
   *                 senderAccountInfo captured for Lock 2 reuse
   *                 cache := { value: signerNonce + 1, version: randomUUID() }
   *                 tx.admittedVersion := cache.version
   *      b. await saveTransaction
   *         on save failure → decrement cache (gen-matched) → throw INTERNAL_ERROR
   *   3. release Lock 1
   *   4. acquire Lock 2 (execution lock)
   *   5. balance check (reuse senderAccountInfo on cold; fresh verifyAccount on warm)
   *      validateReceiverAndGasStateful (gas and receiver)
   *      on failure → decrement cache (gen-matched) → remove pool entry → release Lock 2 → throw
   *   6. hand off to sendRawTransactionProcessor (CN submission + outcome handling)
   *
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

    // Stateless precheck outside any lock so malformed inputs never queue for the ingress lock.
    this.precheck.validateBasicPropertiesStateless(parsedTx);
    const senderAddress = parsedTx.from!;

    // ===== Lock 1: ingress lock =====
    // Transactions will be added one by one, so there will be no race condition on this operation.
    const admitResult = await this.admitTransaction(senderAddress, parsedTx, requestDetails);

    // ===== Lock 2: execution lock =====
    // Per-sender serialization of CN submission preserves the FIFO order established by Lock 1.
    const executionResult = await this.prepareExecution(senderAddress, parsedTx, requestDetails, admitResult.balance);

    // Hand off to the processor: CN submit → release Lock 2 → MN poll (success) or rollback (pre-exec failure).
    const sendRawTransactionProcessorPromise = this.sendRawTransactionProcessor(
      transactionBuffer,
      parsedTx,
      executionResult.networkGasPriceInWeiBars,
      executionResult.execLockResult,
      requestDetails,
    );
    if (!ConfigService.get('USE_ASYNC_TX_PROCESSING')) return await sendRawTransactionProcessorPromise;
    void sendRawTransactionProcessorPromise.catch(() =>
      this.logger.error(
        'Transaction %s failed asynchronously', // More details already logged by sendRawTransactionProcessor
        parsedTx.hash,
      ),
    );
    return Utils.computeTransactionHash(transactionBuffer);
  }

  /**
   * Admits a transaction into the local processing pipeline.
   *
   * This method performs nonce-related admission checks under the per-sender
   * ingress lock to guarantee deterministic transaction ordering and prevent
   * concurrent nonce races.
   *
   * The ingress lock is always released, regardless of success or failure,
   * allowing callers to retry immediately on precheck failures.
   *
   * @private
   * @param senderAddress - The sender EVM address.
   * @param parsedTx - Parsed Ethereum transaction.
   * @param requestDetails - Request metadata for logging/tracing.
   * @returns Promise resolving to the verified sender balance if available
   *          from the mirror node artifact.
   * @throws JsonRpcError when transaction persistence fails.
   * @throws Re-throws nonce validation and account retrieval errors.
   */
  private async admitTransaction(
    senderAddress: string,
    parsedTx: EthersTransaction,
    requestDetails: RequestDetails,
  ): Promise<{ balance: IAccountBalance | undefined }> {
    // When DISABLE_MN_PRECHECKS_ON_TX_SENDING is enabled, skip the entire ingress-admission phase.
    // accountService.getTransactionCounts() reaches the Mirror Node (cold path) to read the
    // confirmed nonce, and precheck.nonce / saveTransaction both depend on that reading — none of
    // them can run without a Mirror Node call. Per-sender execution ordering is still preserved by
    // the execution lock acquired in prepareExecution(); the consensus node performs the
    // authoritative nonce check and rejects out-of-order transactions with WRONG_NONCE.
    if (ConfigService.get('DISABLE_MN_PRECHECKS_ON_TX_SENDING')) {
      return { balance: undefined };
    }

    const ingressLockKey = `${senderAddress}:ingress`;
    const ingressLockResult = await this.lockService.acquireLock(ingressLockKey);

    let verifiedBalance: IAccountBalance | undefined;
    try {
      const { confirmedCount, pendingCount, mirrorNodeArtifact } = await this.accountService.getTransactionCounts(
        senderAddress,
        requestDetails,
      );
      verifiedBalance = mirrorNodeArtifact?.balance;

      // When we do NOT enforce ordered processing, we cannot reliably determine the state of all currently
      // pending transactions being processed. Because of that, the safest approach is to verify only that
      // the submitted nonce is greater than or equal to the number of transactions already confirmed by
      // the Mirror Node.
      const expectedNonce = !ConfigService.get('ENABLE_NONCE_ORDERING')
        ? confirmedCount
        : confirmedCount + pendingCount;
      this.precheck.nonce(parsedTx, expectedNonce);

      // save transaction to pool
      await this.transactionPoolService.saveTransaction(senderAddress, parsedTx, confirmedCount);
    } catch (error) {
      if (error instanceof JsonRpcError) throw error;

      // throw to clients instead of silently ignore because if ignored and still let the tx moves on to Lock 2 and CN.
      // CN can accept it. MN will reflect the nonce. But the pool never had the entry, and the txpool_ endpoints will
      // return a wrong pending state.
      // Mirror Node ingress / pool persistence errors surface here as INTERNAL_ERROR - trace them as rejected.
      // Recorded for admin inspection: this error is thrown synchronously to the client (before the async
      // hash return), so the receipt fallback never consults it.
      const rejection = predefined.INTERNAL_ERROR(`Failed to save transaction to pool: ${(error as Error).message}`);
      await this.transactionTracingService.recordRejected(parsedTx.hash!, { error: rejection.message });
      throw rejection;
    } finally {
      // Release Lock 1 regardless of outcome so that the caller can retry immediately if it was a precheck failure,
      // or after a short wait if it was an MN or pool failure.
      if (ingressLockResult) {
        await this.lockService.releaseLock(ingressLockKey, ingressLockResult.sessionKey, ingressLockResult.acquiredAt);
      }
    }

    // Trace the pending state - only meaningful when the tx pool write actually happened. Recorded here, not
    // inside the try, so the write never holds Lock 1: `finally` has already released it, and reaching this
    // point means saveTransaction succeeded because every failure path above throws.
    if (ConfigService.get('ENABLE_TX_POOL')) {
      await this.transactionTracingService.recordPending(parsedTx.hash!);
    }

    return { balance: verifiedBalance };
  }

  /**
   * Performs all stateful execution prechecks before the transaction is submitted
   * to the consensus node.
   *
   * This method acquires the per-sender execution lock to preserve FIFO ordering
   * established during the admission phase and prevent concurrent transaction
   * execution for the same sender.
   *
   * @private
   * @param senderAddress - The sender EVM address.
   * @param parsedTx - Parsed Ethereum transaction.
   * @param verifiedBalance - Previously fetched sender balance if available.
   * @param requestDetails - Request metadata for logging/tracing.
   * @returns Promise resolving to the acquired execution lock result and
   *          normalized network gas price in weibars.
   * @throws Re-throws any validation or network-related error encountered
   *         during execution prechecks.
   */
  private async prepareExecution(
    senderAddress: string,
    parsedTx: EthersTransaction,
    requestDetails: RequestDetails,
    verifiedBalance?: IAccountBalance,
  ): Promise<{ networkGasPriceInWeiBars: number; execLockResult?: LockAcquisitionResult }> {
    const execLockKey = `${senderAddress}:exec`;
    let execLockResult = await this.lockService.acquireLock(execLockKey);
    let networkGasPriceInWeiBars: number;
    const disableMnPrechecks = ConfigService.get('DISABLE_MN_PRECHECKS_ON_TX_SENDING');

    let shouldLockBeReleased = false;
    try {
      // When DISABLE_MN_PRECHECKS_ON_TX_SENDING is enabled, skip the Mirror Node gas-price
      // fetch entirely. Use the user's own signed gas price (from tx.gasPrice or, for
      // EIP-1559, maxFeePerGas + maxPriorityFeePerGas) as the basis for the Hedera
      // `maxTransactionFee` cap — the user already committed to paying that, so it is the
      // most defensible local upper bound and avoids guessing with a stale config default.
      const rawNetworkGasPriceInWeiBars = disableMnPrechecks
        ? Number(parsedTx.gasPrice ?? parsedTx.maxFeePerGas! + parsedTx.maxPriorityFeePerGas!)
        : await this.common.getGasPriceInWeibars(requestDetails);
      networkGasPriceInWeiBars = Utils.addPercentageBufferToGasPrice(rawNetworkGasPriceInWeiBars);

      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `Transaction undergoing account and network (stateful) prechecks: transaction=%s`,
          JSON.stringify(parsedTx),
        );
      }

      // When DISABLE_MN_PRECHECKS_ON_TX_SENDING is enabled, every Mirror Node-dependent stateful
      // precheck is skipped: precheck.balance needs the account balance, and
      // validateReceiverAndGasStateful needs receiver_sig_required plus a network gas-price anchor.
      // All Mirror Node-free prechecks (including accessList) already ran in
      // validateBasicPropertiesStateless at the start of sendRawTransaction, so there is nothing
      // to run here. Underpriced or underfunded transactions are surfaced by the consensus node.
      if (!disableMnPrechecks) {
        // precheck sender balance
        this.precheck.balance(
          parsedTx,
          verifiedBalance ?? (await this.precheck.verifyAccount(parsedTx, requestDetails)).balance,
        );

        // precheck gas price and receiver
        await this.precheck.validateReceiverAndGasStateful(parsedTx, networkGasPriceInWeiBars, requestDetails);
      }
    } catch (error) {
      // The lock will be released in the next step, after full transaction is submitted (sendRawTransactionProcessor).
      // If an error occurs at this stage, however, we should release the lock immediately regardless
      // of the processing mode, because there will be no submission attempt, and we need to unlock next transactions.
      shouldLockBeReleased = true;
      await this.transactionPoolService.removeTransaction(senderAddress, parsedTx.serialized);
      // Stateful precheck / Mirror Node ingress failures before submission - trace as rejected.
      // Recorded for admin inspection: this error is thrown synchronously to the client (before the async
      // hash return), so the receipt fallback never consults it.
      await this.transactionTracingService.recordRejected(parsedTx.hash!, { error: (error as Error).message });
      throw error;
    } finally {
      if (execLockResult && shouldLockBeReleased) {
        await this.lockService.releaseLock(execLockKey, execLockResult.sessionKey, execLockResult.acquiredAt);
        execLockResult = undefined;
      }
    }

    return { networkGasPriceInWeiBars, execLockResult };
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

    let currentNetworkExchangeRate = await this.cacheService.get(cacheKey, callingMethod);
    if (!currentNetworkExchangeRate) {
      currentNetworkExchangeRate = (await this.mirrorNodeClient.getNetworkExchangeRate(requestDetails)).current_rate;
      await this.cacheService.set(cacheKey, currentNetworkExchangeRate, callingMethod, cacheTTL);
    }
    return currentNetworkExchangeRate.cent_equivalent / currentNetworkExchangeRate.hbar_equivalent;
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
    const contractResults = await this.mirrorNodeClient.getContractResultWithRetry<MirrorNodeContractResult[]>(
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
      from: resolvedFromAddress!,
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

    return TransactionFactory.createTransactionFromLog(this.chain, matchingLog);
  }

  /**
   * Handles the processing of a regular transaction receipt
   * @param receiptResponse The receipt response from the mirror node
   * @param requestDetails The request details for logging and tracking
   * @returns {Promise<ITransactionReceipt>} A promise that resolves to a transaction receipt
   */
  private async handleRegularTransactionReceipt(
    receiptResponse: MirrorNodeContractResultDetails,
    requestDetails: RequestDetails,
  ): Promise<ITransactionReceipt> {
    const effectiveGas = await this.common.getCurrentGasPriceForBlock(receiptResponse.block_hash, requestDetails);
    // support stricter go-eth client which requires the transaction hash property on logs
    const logs = receiptResponse.logs.map((log) => {
      return new Log({
        address: log.address,
        blockHash: toHash32(receiptResponse.block_hash),
        blockNumber: nanOrNumberTo0x(receiptResponse.block_number),
        blockTimestamp: numberTo0x(Number(receiptResponse.timestamp.split('.')[0])),
        data: log.data,
        logIndex: numberTo0x(log.index),
        removed: false,
        topics: log.topics,
        transactionHash: toHash32(receiptResponse.hash),
        transactionIndex: nanOrNumberTo0x(receiptResponse.transaction_index),
      });
    });
    const [from, to] = await Promise.all([
      this.common.resolveEvmAddress(receiptResponse.from, requestDetails),
      this.common.resolveEvmAddress(receiptResponse.to, requestDetails),
    ]);

    let cumulativeGasUsed = 0;
    if (receiptResponse.transaction_index != null && receiptResponse.transaction_index > 0) {
      const params: IContractResultsParams = {
        blockNumber: receiptResponse.block_number ?? undefined,
      };

      const blockContractResults = await this.mirrorNodeClient.getContractResults(requestDetails, params);

      if (Array.isArray(blockContractResults)) {
        for (const cr of blockContractResults) {
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
      cumulativeGasUsed = receiptResponse.gas_used ?? 0;
    }

    return TransactionReceiptFactory.createRegularReceipt({
      effectiveGas,
      from: from!,
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
   * Asynchronously processes a raw transaction by submitting it to the network, managing HFS,
   * handling errors, and returning the transaction hash.
   *
   * @async
   * @param {Buffer} transactionBuffer - The raw transaction data as a buffer.
   * @param {EthersTransaction} parsedTx - The parsed Ethereum transaction object.
   * @param {number} networkGasPriceInWeiBars - The current network gas price in wei bars.
   * @param {LockAcquisitionResult | undefined} execLockResult - The lock acquisition result containing session key and timestamp, undefined if no lock was acquired.
   * @param {RequestDetails} requestDetails - Details of the request for logging and tracking purposes.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash if successful, or a JsonRpcError if an error occurs.
   */
  async sendRawTransactionProcessor(
    transactionBuffer: Buffer,
    parsedTx: EthersTransaction,
    networkGasPriceInWeiBars: number,
    execLockResult: LockAcquisitionResult | undefined,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const senderAddress = parsedTx.from!;
    const execLockKey = `${senderAddress}:exec`;

    this.eventEmitter.emit('eth_execution', {
      method: constants.ETH_SEND_RAW_TRANSACTION,
    });

    const { submittedTransactionId, error } = await this.submitTransaction(
      transactionBuffer,
      senderAddress,
      networkGasPriceInWeiBars,
      requestDetails,
    );

    // Release Lock 2 once CN responds, regardless of outcome for other transactions can start being processed ASAP
    if (execLockResult) {
      await this.lockService.releaseLock(execLockKey, execLockResult.sessionKey, execLockResult.acquiredAt);
    }

    // A clean submission (no error) means the CN accepted the transaction - trace the sent state,
    // capturing the transaction id so the record is resolvable by id. Recorded after the lock release so a
    // tracing-store write never holds the per-sender lock.
    if (!error) {
      await this.transactionTracingService.recordSent(parsedTx.hash!, submittedTransactionId || undefined);
    }

    const { error: submissionError, shouldPollAndCleanup } = await this.handleSubmissionError(
      error,
      parsedTx,
      senderAddress,
      requestDetails,
    );

    if (shouldPollAndCleanup) {
      if (ConfigService.get('ENABLE_NONCE_ORDERING') && ConfigService.get('ENABLE_TX_POOL')) {
        void this.pollMirrorNodeAndCleanup(parsedTx, requestDetails);
      } else {
        await this.transactionPoolService.removeTransaction(senderAddress, parsedTx.serialized, 'confirmed');
      }
    }

    if (submissionError) throw submissionError;
    return Utils.computeTransactionHash(transactionBuffer);
  }

  /**
   * Classifies the CN submission outcome and signals what cleanup the caller should do.
   *
   * Returns { error, shouldPollAndCleanup }:
   *   error               — the error to throw at the call site, or null on success/post-exec
   *   shouldPollAndCleanup — true when CN outcome is unknown or the tx landed (poll to clean pool)
   *                          false on confirmed pre-exec failure (cleanup done here, no poll needed)
   *
   * Classification:
   *   no error            → success               → { null, true }
   *   non-SDK error       → outcome unknown        → { error, true }
   *   SDK timeout/dropped → outcome unknown        → { error, true }
   *   pre-exec failure    → nonce didn't move      → rollback + { preExecError, false }
   *   post-exec failure   → nonce moved            → { null, true }
   */
  private async handleSubmissionError(
    error: any,
    parsedTx: EthersTransaction,
    senderAddress: string,
    requestDetails: RequestDetails,
  ): Promise<{ error: any; shouldPollAndCleanup: boolean }> {
    // Success: nothing to trace here (the processor already recorded `sent`).
    if (!error) return { error: null, shouldPollAndCleanup: true };

    // Non-SDK submission error (e.g. INTERNAL_ERROR on a malformed transaction id): outcome unknown, so
    // trace as timedout (provisional). Without this, an async-mode failure after the hash returned would
    // be untraced and receipt polling would return null forever.
    if (!(error instanceof SDKClientError)) {
      await this.transactionTracingService.recordTimedout(parsedTx.hash!, { error: (error as Error).message });
      return { error, shouldPollAndCleanup: true };
    }

    this.hapiService.decrementErrorCounter(error.statusCode);

    if (error.isTimeoutExceeded() || error.isConnectionDropped() || error.isGrpcTimeout()) {
      // Outcome unknown - the tx may still reach consensus within the validity window. Trace as timedout (provisional).
      await this.transactionTracingService.recordTimedout(parsedTx.hash!, {
        error: error.message,
        hederaStatus: error.status?.toString(),
        transactionId: error.transactionId || undefined,
      });
      return { error, shouldPollAndCleanup: true };
    }

    const preExecutionFailures: string[] = ConfigService.get('HEDERA_SPECIFIC_REVERT_STATUSES');
    if (preExecutionFailures.includes(error.status.toString())) {
      let preExecError: JsonRpcError;

      if (error.status.toString() === constants.TRANSACTION_RESULT_STATUS.WRONG_NONCE) {
        if (!ConfigService.get('ENABLE_NONCE_ORDERING')) {
          this.wrongNonceMetric.labels('none').inc();
        } else {
          this.wrongNonceMetric.labels(this.lockService.getStrategyType()).inc();
        }

        let accountNonce: number | null = null;
        // When DISABLE_MN_PRECHECKS_ON_TX_SENDING is enabled, skip the Mirror Node lookup and fall
        // through to the generic TRANSACTION_REJECTED response below — operators in this
        // mode have opted out of MN-validated error classification.
        if (!ConfigService.get('DISABLE_MN_PRECHECKS_ON_TX_SENDING')) {
          try {
            const txCounts = await this.accountService.getTransactionCounts(parsedTx.from!, requestDetails);
            // Decrementing because currently investigated transaction is still placed on the pending queue.
            accountNonce = txCounts.pendingCount + txCounts.confirmedCount - 1;
          } catch (mirrorNodeError) {
            // Mirror Node request failed (e.g., 404, 429, 5xx)
            // Simply ignore and fallback to the original rejection to avoid masking the true error
            this.logger.debug(mirrorNodeError, `Failed to fetch account nonce for WRONG_NONCE error handling`);
          }
        }

        if (accountNonce != null && accountNonce !== parsedTx.nonce) {
          preExecError =
            parsedTx.nonce > accountNonce
              ? predefined.NONCE_TOO_HIGH(parsedTx.nonce, accountNonce)
              : predefined.NONCE_TOO_LOW(parsedTx.nonce, accountNonce);
        } else {
          preExecError = predefined.TRANSACTION_REJECTED(error.status.toString(), error.message);
        }
      } else {
        preExecError = predefined.TRANSACTION_REJECTED(error.status.toString(), error.message);
      }

      // Pre-execution rejection (WRONG_NONCE / TRANSACTION_REJECTED / NONCE_TOO_*) - trace it so a later
      // receipt poll can surface the failure to a client holding only the hash.
      await this.transactionTracingService.recordRejected(parsedTx.hash!, {
        error: preExecError.message,
        hederaStatus: error.status.toString(),
        transactionId: error.transactionId || undefined,
      });

      // pre-execution failure would not have moved the nonce, safe to roll back and clean up here without needing to poll MN for certainty
      await this.transactionPoolService.removeTransaction(senderAddress, parsedTx.serialized);

      return { error: preExecError, shouldPollAndCleanup: false };
    }

    // Post-exec: nonce moved, leave pool entry for the MN-poll watcher
    return { error: null, shouldPollAndCleanup: true };
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
      // Pass a lazy getter so the exchange rate is only fetched when the HFS path is actually
      // taken (JUMBO_TX_ENABLED=false AND callData.length > fileAppendChunkSize).
      // When DISABLE_MN_PRECHECKS_ON_TX_SENDING is enabled, the getter returns 0 (sentinel
      // that skips the preemptive HBAR rate-limit check inside SDKClient.createFile).
      const exchangeRateGetter: () => Promise<number> = ConfigService.get('DISABLE_MN_PRECHECKS_ON_TX_SENDING')
        ? (): Promise<number> => Promise.resolve(0)
        : (): Promise<number> => this.getCurrentNetworkExchangeRateInCents(requestDetails);

      const sendRawTransactionResult = await this.hapiService.submitEthereumTransaction(
        transactionBuffer,
        constants.ETH_SEND_RAW_TRANSACTION,
        requestDetails,
        originalCallerAddress,
        networkGasPriceInWeiBars,
        exchangeRateGetter,
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
        void this.hapiService.deleteFile(
          fileId,
          requestDetails,
          constants.ETH_SEND_RAW_TRANSACTION,
          originalCallerAddress,
        );
      }
    }

    return { submittedTransactionId, error };
  }

  // ===== MN poll cleanup =====
  // Polls MN for the receipt; removes the pool entry once MN reflects, or after max attempts (zombie cleanup).
  private async pollMirrorNodeAndCleanup(parsedTx: EthersTransaction, requestDetails: RequestDetails): Promise<void> {
    const senderAddress = parsedTx.from!.toString();
    const txHash = parsedTx.hash!;
    const maxAttempts = ConfigService.get('SEND_RAW_TRANSACTION_POLLING_MAX_ATTEMPTS');
    const intervalMs = ConfigService.get('SEND_RAW_TRANSACTION_POLLING_INTERVAL_MS');

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      try {
        const result = await this.mirrorNodeClient.getContractResult(txHash, requestDetails);
        if (result?.hash) {
          await this.transactionTracingService.recordValidated(txHash);
          await this.transactionPoolService.removeTransaction(senderAddress, parsedTx.serialized, 'confirmed');
          return;
        }
      } catch {
        this.logger.error('Mirror Node poll failed for transaction %s on %d attempt', txHash, i);
      }
    }
    // zombie cleanup: max attempts reached, remove anyway
    // we don't know if the transaction was actually executed or not...
    this.logger.error('Zombie cleanup: transaction %s not found in Mirror Node after %d attempts', txHash, maxAttempts);
    await this.transactionPoolService.removeTransaction(senderAddress, parsedTx.serialized);
  }
}
