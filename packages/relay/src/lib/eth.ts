// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { FileId, Hbar, PrecheckStatusError } from '@hashgraph/sdk';
import crypto from 'crypto';
import { Transaction as EthersTransaction } from 'ethers';
import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import {
  ASCIIToHex,
  formatContractResult,
  formatTransactionIdWithoutQueryParams,
  getFunctionSelector,
  isHex,
  isValidEthereumAddress,
  nanOrNumberTo0x,
  nullableNumberTo0x,
  numberTo0x,
  parseNumericEnvVar,
  prepend0x,
  toHash32,
  trimPrecedingZeros,
  weibarHexToTinyBarInt,
} from '../formatters';
import { Eth } from '../index';
import { LogsBloomUtils } from '../logsBloomUtils';
import { IReceiptRootHash, ReceiptsRootUtils } from '../receiptsRootUtils';
import { Utils } from '../utils';
import { MirrorNodeClient } from './clients';
import constants from './constants';
import { JsonRpcError, predefined } from './errors/JsonRpcError';
import { MirrorNodeClientError } from './errors/MirrorNodeClientError';
import { SDKClientError } from './errors/SDKClientError';
import { Block, Log, Transaction, Transaction1559 } from './model';
import { Precheck } from './precheck';
import { CacheService } from './services/cacheService/cacheService';
import { DebugService } from './services/debugService';
import { IDebugService } from './services/debugService/IDebugService';
import { CommonService, FilterService } from './services/ethService';
import { IFilterService } from './services/ethService/ethFilterService/IFilterService';
import HAPIService from './services/hapiService/hapiService';
import { IContractCallRequest, IContractCallResponse, IFeeHistory, ITransactionReceipt, RequestDetails } from './types';
import { IAccountInfo } from './types/mirrorNode';

const _ = require('lodash');
const asm = require('@ethersproject/asm');

interface LatestBlockNumberTimestamp {
  blockNumber: string | null;
  timeStampTo: string;
}

/**
 * Implementation of the "eth_" methods from the Ethereum JSON-RPC API.
 * Methods are implemented by delegating to the mirror node or to a
 * consensus node in the main network.
 *
 * FIXME: This class is a work in progress because everything we need is
 * not currently supported by the mirror nodes. As such, we have a lot
 * of fake stuff in this class for now for the purpose of demos and POC.
 */
export class EthImpl implements Eth {
  static emptyHex = '0x';
  static zeroHex = '0x0';
  static oneHex = '0x1';
  static twoHex = '0x2';
  static oneTwoThreeFourHex = '0x1234';
  static zeroHex8Byte = '0x0000000000000000';
  static zeroHex32Byte = '0x0000000000000000000000000000000000000000000000000000000000000000';
  static emptyArrayHex = '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347';
  static zeroAddressHex = '0x0000000000000000000000000000000000000000';
  static emptyBloom =
    '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
  static defaultTxGas = numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT);
  static gasTxBaseCost = numberTo0x(constants.TX_BASE_COST);
  static minGasTxHollowAccountCreation = numberTo0x(constants.MIN_TX_HOLLOW_ACCOUNT_CREATION_GAS);
  static ethTxType = 'EthereumTransaction';
  static defaultGasUsedRatio = 0.5;
  static feeHistoryZeroBlockCountResponse: IFeeHistory = {
    gasUsedRatio: null,
    oldestBlock: EthImpl.zeroHex,
    baseFeePerGas: undefined,
  };
  static readonly feeHistoryEmptyResponse: IFeeHistory = {
    baseFeePerGas: [],
    gasUsedRatio: [],
    reward: [],
    oldestBlock: EthImpl.zeroHex,
  };
  static redirectBytecodePrefix = '6080604052348015600f57600080fd5b506000610167905077618dc65e';
  static redirectBytecodePostfix =
    '600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033';
  static iHTSAddress = '0x0000000000000000000000000000000000000167';
  static invalidEVMInstruction = '0xfe';
  static blockHashLength = 66;

  // endpoint callerNames
  static ethBlockByNumber = 'eth_blockNumber';
  static ethCall = 'eth_call';
  static ethEstimateGas = 'eth_estimateGas';
  static ethFeeHistory = 'eth_feeHistory';
  static ethGasPrice = 'eth_gasPrice';
  static ethGetBalance = 'eth_getBalance';
  static ethGetBlockByHash = 'eth_GetBlockByHash';
  static ethGetBlockByNumber = 'eth_GetBlockByNumber';
  static ethGetCode = 'eth_getCode';
  static ethGetTransactionByHash = 'eth_GetTransactionByHash';
  static ethGetTransactionCount = 'eth_getTransactionCount';
  static ethGetTransactionCountByHash = 'eth_GetTransactionCountByHash';
  static ethGetTransactionCountByNumber = 'eth_GetTransactionCountByNumber';
  static ethGetTransactionReceipt = 'eth_GetTransactionReceipt';
  static ethSendRawTransaction = 'eth_sendRawTransaction';
  static debugTraceTransaction = 'debug_traceTransaction';

  // block constants
  static blockLatest = 'latest';
  static blockEarliest = 'earliest';
  static blockPending = 'pending';
  static blockSafe = 'safe';
  static blockFinalized = 'finalized';

  // static response constants
  static accounts = [];

  /**
   * Overrideable options used when initializing.
   *
   * @private
   */
  private readonly defaultGas = numberTo0x(parseNumericEnvVar('TX_DEFAULT_GAS', 'TX_DEFAULT_GAS_DEFAULT'));
  private readonly contractCallAverageGas = numberTo0x(constants.TX_CONTRACT_CALL_AVERAGE_GAS);
  private readonly ethCallCacheTtl = parseNumericEnvVar('ETH_CALL_CACHE_TTL', 'ETH_CALL_CACHE_TTL_DEFAULT');
  private readonly ethBlockNumberCacheTtlMs = parseNumericEnvVar(
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS',
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT',
  );
  private readonly ethGetBalanceCacheTtlMs = parseNumericEnvVar(
    'ETH_GET_BALANCE_CACHE_TTL_MS',
    'ETH_GET_BALANCE_CACHE_TTL_MS_DEFAULT',
  );
  private readonly maxBlockRange = parseNumericEnvVar('MAX_BLOCK_RANGE', 'MAX_BLOCK_RANGE');
  private readonly contractCallGasLimit = parseNumericEnvVar('CONTRACT_CALL_GAS_LIMIT', 'CONTRACT_CALL_GAS_LIMIT');
  private readonly ethGetTransactionCountMaxBlockRange = ConfigService.get('ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE');
  private readonly ethGetTransactionCountCacheTtl = parseNumericEnvVar(
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
  );
  private readonly estimateGasThrows = ConfigService.get('ESTIMATE_GAS_THROWS');

  private readonly ethGasPRiceCacheTtlMs = parseNumericEnvVar(
    'ETH_GET_GAS_PRICE_CACHE_TTL_MS',
    'ETH_GET_GAS_PRICE_CACHE_TTL_MS_DEFAULT',
  );

  /**
   * Configurable options used when initializing the cache.
   *
   * @private
   */
  private readonly options = {
    //The maximum number (or size) of items that remain in the cache (assuming no TTL pruning or explicit deletions).
    max: ConfigService.get('CACHE_MAX'),
    // Max time to live in ms, for items before they are considered stale.
    ttl: ConfigService.get('CACHE_TTL'),
  };

  /**
   * The LRU cache used for caching items from requests.
   *
   * @private
   */
  private readonly cacheService: CacheService;

  /**
   * The client service which is responsible for client all logic related to initialization, reinitialization and error/transactions tracking.
   *
   * @private
   */
  private readonly hapiService: HAPIService;

  /**
   * The interface through which we interact with the mirror node
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

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
   * The ethExecutionsCounter used to track the number of daily active users and active contract execution requests.
   * @private
   */
  private readonly ethExecutionsCounter: Counter;

  /**
   * The Common Service implementation that contains logic shared by other services.
   */
  private readonly common: CommonService;

  /**
   * The Filter Service implementation that takes care of all filter API operations.
   */
  private readonly filterServiceImpl: FilterService;

  /**
   * The Debug Service implementation that takes care of all filter API operations.
   */
  private readonly debugServiceImpl: DebugService;

  /**
   * Constructs an instance of the service responsible for handling Ethereum JSON-RPC methods
   * using Hedera Hashgraph as the underlying network.
   *
   * @param {HAPIService} hapiService - Service for interacting with Hedera Hashgraph.
   * @param {MirrorNodeClient} mirrorNodeClient - Client for querying the Hedera mirror node.
   * @param {Logger} logger - Logger instance for logging system messages.
   * @param {string} chain - The chain identifier for the current blockchain environment.
   * @param {Registry} registry - Registry instance for registering metrics.
   * @param {CacheService} cacheService - Service for managing cached data.
   */
  constructor(
    hapiService: HAPIService,
    mirrorNodeClient: MirrorNodeClient,
    logger: Logger,
    chain: string,
    registry: Registry,
    cacheService: CacheService,
  ) {
    this.chain = chain;
    this.logger = logger;
    this.hapiService = hapiService;
    this.cacheService = cacheService;
    this.mirrorNodeClient = mirrorNodeClient;
    this.precheck = new Precheck(mirrorNodeClient, logger, chain);
    this.ethExecutionsCounter = this.initCounter(
      'rpc_relay_eth_executions',
      ['method', 'function', 'from', 'to'],
      registry,
    );
    this.common = new CommonService(mirrorNodeClient, logger, cacheService);
    this.debugServiceImpl = new DebugService(mirrorNodeClient, logger, this.common);
    this.filterServiceImpl = new FilterService(mirrorNodeClient, logger, cacheService, this.common);
  }

  private shouldUseCacheForBalance(tag: string | null): boolean {
    // should only cache balance when is Not latest or pending and is not in dev mode
    return !CommonService.blockTagIsLatestOrPendingStrict(tag) && !CommonService.isDevMode;
  }

  private initCounter(metricCounterName: string, labelNames: string[], register: Registry): Counter {
    register.removeSingleMetric(metricCounterName);
    return new Counter({
      name: metricCounterName,
      help: `Relay ${metricCounterName} function`,
      labelNames: labelNames,
      registers: [register],
    });
  }

  filterService(): IFilterService {
    return this.filterServiceImpl;
  }

  debugService(): IDebugService {
    return this.debugServiceImpl;
  }

  /**
   * This method is implemented to always return an empty array. This is in alignment
   * with the behavior of Infura.
   */
  accounts(requestDetails: RequestDetails): never[] {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} accounts()`);
    }
    return EthImpl.accounts;
  }

  private getEthFeeHistoryFixedFee(): boolean {
    return ConfigService.get('ETH_FEE_HISTORY_FIXED');
  }

  /**
   * Gets the fee history.
   */
  async feeHistory(
    blockCount: number,
    newestBlock: string,
    rewardPercentiles: Array<number> | null,
    requestDetails: RequestDetails,
  ): Promise<IFeeHistory | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    const maxResults = ConfigService.get('TEST')
      ? constants.DEFAULT_FEE_HISTORY_MAX_RESULTS
      : Number(ConfigService.get('FEE_HISTORY_MAX_RESULTS'));

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} feeHistory(blockCount=${blockCount}, newestBlock=${newestBlock}, rewardPercentiles=${rewardPercentiles})`,
      );
    }

    try {
      const latestBlockNumber = await this.translateBlockTag(EthImpl.blockLatest, requestDetails);
      const newestBlockNumber =
        newestBlock == EthImpl.blockLatest || newestBlock == EthImpl.blockPending
          ? latestBlockNumber
          : await this.translateBlockTag(newestBlock, requestDetails);

      if (newestBlockNumber > latestBlockNumber) {
        return predefined.REQUEST_BEYOND_HEAD_BLOCK(newestBlockNumber, latestBlockNumber);
      }
      blockCount = blockCount > maxResults ? maxResults : blockCount;

      if (blockCount <= 0) {
        return EthImpl.feeHistoryZeroBlockCountResponse;
      }
      let feeHistory: IFeeHistory;

      if (this.getEthFeeHistoryFixedFee()) {
        let oldestBlock = newestBlockNumber - blockCount + 1;
        if (oldestBlock <= 0) {
          blockCount = 1;
          oldestBlock = 1;
        }
        const gasPriceFee = await this.gasPrice(requestDetails);
        feeHistory = this.getRepeatedFeeHistory(blockCount, oldestBlock, rewardPercentiles, gasPriceFee);
      } else {
        // once we finish testing and refining Fixed Fee method, we can remove this else block to clean up code
        const cacheKey = `${constants.CACHE_KEY.FEE_HISTORY}_${blockCount}_${newestBlock}_${rewardPercentiles?.join(
          '',
        )}`;
        const cachedFeeHistory = await this.cacheService.getAsync(cacheKey, EthImpl.ethFeeHistory, requestDetails);

        if (cachedFeeHistory) {
          feeHistory = cachedFeeHistory;
        } else {
          feeHistory = await this.getFeeHistory(
            blockCount,
            newestBlockNumber,
            latestBlockNumber,
            rewardPercentiles,
            requestDetails,
          );
        }
        if (newestBlock != EthImpl.blockLatest && newestBlock != EthImpl.blockPending) {
          await this.cacheService.set(
            cacheKey,
            feeHistory,
            EthImpl.ethFeeHistory,
            requestDetails,
            parseInt(constants.ETH_FEE_HISTORY_TTL),
          );
        }
      }

      return feeHistory;
    } catch (e) {
      this.logger.error(e, `${requestIdPrefix} Error constructing default feeHistory`);
      return EthImpl.feeHistoryEmptyResponse;
    }
  }

  private async getFeeByBlockNumber(blockNumber: number, requestDetails: RequestDetails): Promise<string> {
    let fee = 0;
    try {
      const block = await this.mirrorNodeClient.getBlock(blockNumber, requestDetails);
      fee = await this.getFeeWeibars(EthImpl.ethFeeHistory, requestDetails, `lte:${block.timestamp.to}`);
    } catch (error) {
      this.logger.warn(
        error,
        `${requestDetails.formattedRequestId} Fee history cannot retrieve block or fee. Returning ${fee} fee for block ${blockNumber}`,
      );
    }

    return numberTo0x(fee);
  }

  private getRepeatedFeeHistory(
    blockCount: number,
    oldestBlockNumber: number,
    rewardPercentiles: Array<number> | null,
    fee: string,
  ): IFeeHistory {
    const shouldIncludeRewards = Array.isArray(rewardPercentiles) && rewardPercentiles.length > 0;

    const feeHistory: IFeeHistory = {
      baseFeePerGas: Array(blockCount).fill(fee),
      gasUsedRatio: Array(blockCount).fill(EthImpl.defaultGasUsedRatio),
      oldestBlock: numberTo0x(oldestBlockNumber),
    };

    // next fee. Due to high block production rate and low fee change rate we add the next fee
    // since by the time a user utilizes the response there will be a next block likely with the same fee
    feeHistory.baseFeePerGas?.push(fee);

    if (shouldIncludeRewards) {
      feeHistory['reward'] = Array(blockCount).fill(Array(rewardPercentiles.length).fill(EthImpl.zeroHex));
    }

    return feeHistory;
  }

  private async getFeeHistory(
    blockCount: number,
    newestBlockNumber: number,
    latestBlockNumber: number,
    rewardPercentiles: Array<number> | null,
    requestDetails: RequestDetails,
  ): Promise<IFeeHistory> {
    // include the newest block number in the total block count
    const oldestBlockNumber = Math.max(0, newestBlockNumber - blockCount + 1);
    const shouldIncludeRewards = Array.isArray(rewardPercentiles) && rewardPercentiles.length > 0;
    const feeHistory: IFeeHistory = {
      baseFeePerGas: [] as string[],
      gasUsedRatio: [] as number[],
      oldestBlock: numberTo0x(oldestBlockNumber),
    };

    // get fees from oldest to newest blocks
    for (let blockNumber = oldestBlockNumber; blockNumber <= newestBlockNumber; blockNumber++) {
      const fee = await this.getFeeByBlockNumber(blockNumber, requestDetails);

      feeHistory.baseFeePerGas?.push(fee);
      feeHistory.gasUsedRatio?.push(EthImpl.defaultGasUsedRatio);
    }

    // get latest block fee
    let nextBaseFeePerGas: string = _.last(feeHistory.baseFeePerGas);

    if (latestBlockNumber > newestBlockNumber) {
      // get next block fee if the newest block is not the latest
      nextBaseFeePerGas = await this.getFeeByBlockNumber(newestBlockNumber + 1, requestDetails);
    }

    if (nextBaseFeePerGas) {
      feeHistory.baseFeePerGas?.push(nextBaseFeePerGas);
    }

    if (shouldIncludeRewards) {
      feeHistory['reward'] = Array(blockCount).fill(Array(rewardPercentiles.length).fill(EthImpl.zeroHex));
    }

    return feeHistory;
  }

  private async getFeeWeibars(callerName: string, requestDetails: RequestDetails, timestamp?: string): Promise<number> {
    let networkFees;

    try {
      networkFees = await this.mirrorNodeClient.getNetworkFees(requestDetails, timestamp, undefined);
    } catch (e: any) {
      this.logger.warn(
        e,
        `${requestDetails.formattedRequestId} Mirror Node threw an error while retrieving fees. Fallback to consensus node.`,
      );
    }

    if (_.isNil(networkFees)) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} Mirror Node returned no network fees. Fallback to consensus node.`,
        );
      }
      networkFees = {
        fees: [
          {
            gas: await this.hapiService.getSDKClient().getTinyBarGasFee(callerName, requestDetails),
            transaction_type: EthImpl.ethTxType,
          },
        ],
      };
    }

    if (networkFees && Array.isArray(networkFees.fees)) {
      const txFee = networkFees.fees.find(({ transaction_type }) => transaction_type === EthImpl.ethTxType);
      if (txFee?.gas) {
        // convert tinyBars into weiBars
        const weibars = Hbar.fromTinybars(txFee.gas).toTinybars().multiply(constants.TINYBAR_TO_WEIBAR_COEF);

        return weibars.toNumber();
      }
    }

    throw predefined.COULD_NOT_ESTIMATE_GAS_PRICE;
  }

  /**
   * Gets the most recent block number.
   */
  async blockNumber(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} blockNumber()`);
    }
    return await this.common.getLatestBlockNumber(requestDetails);
  }

  /**
   * Gets the most recent block number and timestamp.to which represents the block finality.
   */
  async blockNumberTimestamp(caller: string, requestDetails: RequestDetails): Promise<LatestBlockNumberTimestamp> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} blockNumber()`);
    }

    const cacheKey = `${constants.CACHE_KEY.ETH_BLOCK_NUMBER}`;

    const blocksResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails);
    const blocks = blocksResponse !== null ? blocksResponse.blocks : null;
    if (Array.isArray(blocks) && blocks.length > 0) {
      const currentBlock = numberTo0x(blocks[0].number);
      const timestamp = blocks[0].timestamp.to;
      const blockTimeStamp: LatestBlockNumberTimestamp = { blockNumber: currentBlock, timeStampTo: timestamp };
      // save the latest block number in cache
      await this.cacheService.set(cacheKey, currentBlock, caller, requestDetails, this.ethBlockNumberCacheTtlMs);

      return blockTimeStamp;
    }

    throw predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK;
  }

  /**
   * Gets the chain ID. This is a static value, in that it always returns
   * the same value. This can be specified via an environment variable
   * `CHAIN_ID`.
   */
  chainId(requestDetails: RequestDetails): string {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} chainId()`);
    }
    return this.chain;
  }

  /**
   * Estimates the amount of gas to execute a call.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async estimateGas(
    transaction: IContractCallRequest,
    _blockParam: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    const callData = transaction.data ? transaction.data : transaction.input;
    const callDataSize = callData ? callData.length : 0;

    if (callDataSize >= constants.FUNCTION_SELECTOR_CHAR_LENGTH) {
      this.ethExecutionsCounter
        .labels(
          EthImpl.ethEstimateGas,
          callData!.substring(0, constants.FUNCTION_SELECTOR_CHAR_LENGTH),
          transaction.from || '',
          transaction.to || '',
        )
        .inc();
    }

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} estimateGas(transaction=${JSON.stringify(transaction)}, _blockParam=${_blockParam})`,
      );
    }

    try {
      const response = await this.estimateGasFromMirrorNode(transaction, requestDetails);
      if (response?.result) {
        this.logger.info(`${requestIdPrefix} Returning gas: ${response.result}`);
        return prepend0x(trimPrecedingZeros(response.result));
      } else {
        this.logger.error(`${requestIdPrefix} No gas estimate returned from mirror-node: ${JSON.stringify(response)}`);
        return this.predefinedGasForTransaction(transaction, requestDetails);
      }
    } catch (e: any) {
      this.logger.error(
        `${requestIdPrefix} Error raised while fetching estimateGas from mirror-node: ${JSON.stringify(e)}`,
      );
      // in case of contract revert, we don't want to return a predefined gas but the actual error with the reason
      if (this.estimateGasThrows && e instanceof MirrorNodeClientError && e.isContractRevertOpcodeExecuted()) {
        return predefined.CONTRACT_REVERT(e.detail ?? e.message, e.data);
      }
      return this.predefinedGasForTransaction(transaction, requestDetails, e);
    }
  }

  /**
   * Executes an estimate contract call gas request in the mirror node.
   *
   * @param {IContractCallRequest} transaction The transaction data for the contract call.
   * @param {RequestDetails} requestDetails The request details for logging and tracking.
   * @returns {Promise<IContractCallResponse>} the response from the mirror node
   */
  private async estimateGasFromMirrorNode(
    transaction: IContractCallRequest,
    requestDetails: RequestDetails,
  ): Promise<IContractCallResponse | null> {
    await this.contractCallFormat(transaction, requestDetails);
    const callData = { ...transaction, estimate: true };
    return this.mirrorNodeClient.postContractCall(callData, requestDetails);
  }

  /**
   * Fallback calculations for the amount of gas to be used for a transaction.
   * This method is used when the mirror node fails to return a gas estimate.
   *
   * @param {IContractCallRequest} transaction The transaction data for the contract call.
   * @param {RequestDetails} requestDetails The request details for logging and tracking.
   * @param error (Optional) received error from the mirror-node contract call request.
   * @returns {Promise<string | JsonRpcError>} the calculated gas cost for the transaction
   */
  private async predefinedGasForTransaction(
    transaction: IContractCallRequest,
    requestDetails: RequestDetails,
    error?: any,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    const isSimpleTransfer = !!transaction?.to && (!transaction.data || transaction.data === '0x');
    const isContractCall =
      !!transaction?.to && transaction?.data && transaction.data.length >= constants.FUNCTION_SELECTOR_CHAR_LENGTH;
    const isContractCreate = !transaction?.to && transaction?.data && transaction.data !== '0x';

    if (isSimpleTransfer) {
      // Handle Simple Transaction and Hollow Account creation
      const isZeroOrHigher = Number(transaction.value) >= 0;
      if (!isZeroOrHigher) {
        return predefined.INVALID_PARAMETER(
          0,
          `Invalid 'value' field in transaction param. Value must be greater than or equal to 0`,
        );
      }
      // when account exists return default base gas
      if (await this.getAccount(transaction.to!, requestDetails)) {
        this.logger.warn(`${requestIdPrefix} Returning predefined gas for simple transfer: ${EthImpl.gasTxBaseCost}`);
        return EthImpl.gasTxBaseCost;
      }
      // otherwise, return the minimum amount of gas for hollow account creation
      this.logger.warn(
        `${requestIdPrefix} Returning predefined gas for hollow account creation: ${EthImpl.minGasTxHollowAccountCreation}`,
      );
      return EthImpl.minGasTxHollowAccountCreation;
    } else if (isContractCreate) {
      // The size limit of the encoded contract posted to the mirror node can
      // cause contract deployment transactions to fail with a 400 response code.
      // The contract is actually deployed on the consensus node, so the contract will work.
      // In these cases, we don't want to return a CONTRACT_REVERT error.
      if (
        this.estimateGasThrows &&
        error?.isContractReverted() &&
        error?.message !== MirrorNodeClientError.messages.INVALID_HEX
      ) {
        return predefined.CONTRACT_REVERT(error.detail, error.data);
      }
      this.logger.warn(`${requestIdPrefix} Returning predefined gas for contract creation: ${EthImpl.gasTxBaseCost}`);
      return numberTo0x(Precheck.transactionIntrinsicGasCost(transaction.data!));
    } else if (isContractCall) {
      this.logger.warn(`${requestIdPrefix} Returning predefined gas for contract call: ${this.contractCallAverageGas}`);
      return this.contractCallAverageGas;
    } else {
      this.logger.warn(`${requestIdPrefix} Returning predefined gas for unknown transaction: ${this.defaultGas}`);
      return this.defaultGas;
    }
  }

  /**
   * Tries to get the account with the given address from the cache,
   * if not found, it fetches it from the mirror node.
   *
   * @param {string} address the address of the account
   * @param {RequestDetails} requestDetails the request details for logging and tracking
   * @returns {Promise<IAccountInfo | null>} the account (if such exists for the given address)
   */
  private async getAccount(address: string, requestDetails: RequestDetails): Promise<IAccountInfo | null> {
    const key = `${constants.CACHE_KEY.ACCOUNT}_${address}`;
    let account = await this.cacheService.getAsync(key, EthImpl.ethEstimateGas, requestDetails);
    if (!account) {
      account = await this.mirrorNodeClient.getAccount(address, requestDetails);
      await this.cacheService.set(key, account, EthImpl.ethEstimateGas, requestDetails);
    }
    return account;
  }

  /**
   * Perform value format precheck before making contract call towards the mirror node
   * @param {IContractCallRequest} transaction the transaction object
   * @param {RequestDetails} requestDetails the request details for logging and tracking
   */
  async contractCallFormat(transaction: IContractCallRequest, requestDetails: RequestDetails): Promise<void> {
    if (transaction.value) {
      transaction.value = weibarHexToTinyBarInt(transaction.value);
    }
    if (transaction.gasPrice) {
      transaction.gasPrice = parseInt(transaction.gasPrice.toString());
    } else {
      transaction.gasPrice = await this.gasPrice(requestDetails).then((gasPrice) => parseInt(gasPrice));
    }
    if (transaction.gas) {
      transaction.gas = parseInt(transaction.gas.toString());
    }
    if (!transaction.from && transaction.value && (transaction.value as number) > 0) {
      if (ConfigService.get('OPERATOR_KEY_FORMAT') === 'HEX_ECDSA') {
        transaction.from = this.hapiService.getMainClientInstance().operatorPublicKey?.toEvmAddress();
      } else {
        const operatorId = this.hapiService.getMainClientInstance().operatorAccountId!.toString();
        const operatorAccount = await this.getAccount(operatorId, requestDetails);
        transaction.from = operatorAccount?.evm_address;
      }
    }

    // Support either data or input. https://ethereum.github.io/execution-apis/api-documentation/ lists input but many EVM tools still use data.
    // We chose in the mirror node to use data field as the correct one, however for us to be able to support all tools,
    // we have to modify transaction object, so that it complies with the mirror node.
    // That means that, if input field is passed, but data is not, we have to copy value of input to the data to comply with mirror node.
    // The second scenario occurs when both the data and input fields are present but hold different values.
    // In this case, the value in the input field should be the one used for consensus based on this resource https://github.com/ethereum/execution-apis/blob/main/tests/eth_call/call-contract.io
    // Eventually, for optimization purposes, we can rid of the input property or replace it with empty string.
    if ((transaction.input && transaction.data === undefined) || (transaction.input && transaction.data)) {
      transaction.data = transaction.input;
      delete transaction.input;
    }
  }

  /**
   * Retrieves the current network gas price in weibars.
   *
   * @param {string} [requestIdPrefix] - An optional prefix for the request ID used for logging purposes.
   * @returns {Promise<string>} The current gas price in weibars as a hexadecimal string.
   * @throws Will throw an error if unable to retrieve the gas price.
   */
  async gasPrice(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} eth_gasPrice`);
    }
    try {
      let gasPrice: number | undefined = await this.cacheService.getAsync(
        constants.CACHE_KEY.GAS_PRICE,
        EthImpl.ethGasPrice,
        requestDetails,
      );

      if (!gasPrice) {
        gasPrice = Utils.addPercentageBufferToGasPrice(await this.getFeeWeibars(EthImpl.ethGasPrice, requestDetails));

        await this.cacheService.set(
          constants.CACHE_KEY.GAS_PRICE,
          gasPrice,
          EthImpl.ethGasPrice,
          requestDetails,
          this.ethGasPRiceCacheTtlMs,
        );
      }

      return numberTo0x(gasPrice);
    } catch (error) {
      throw this.common.genericErrorHandler(error, `${requestDetails.formattedRequestId} Failed to retrieve gasPrice`);
    }
  }

  /**
   * Gets whether this "Ethereum client" is a miner. We don't mine, so this always returns false.
   */
  async mining(requestDetails: RequestDetails): Promise<boolean> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} mining()`);
    }
    return false;
  }

  /**
   * TODO Needs docs, or be removed?
   */
  async submitWork(requestDetails: RequestDetails): Promise<boolean> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} submitWork()`);
    }
    return false;
  }

  /**
   * TODO Needs docs, or be removed?
   */
  async syncing(requestDetails: RequestDetails): Promise<boolean> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} syncing()`);
    }
    return false;
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   */
  async getUncleByBlockHashAndIndex(requestDetails: RequestDetails): Promise<null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleByBlockHashAndIndex()`);
    }
    return null;
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   */
  async getUncleByBlockNumberAndIndex(requestDetails: RequestDetails): Promise<null> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleByBlockNumberAndIndex()`);
    }
    return null;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   */
  async getUncleCountByBlockHash(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleCountByBlockHash()`);
    }
    return EthImpl.zeroHex;
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   */
  async getUncleCountByBlockNumber(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getUncleCountByBlockNumber()`);
    }
    return EthImpl.zeroHex;
  }

  /**
   * TODO Needs docs, or be removed?
   */
  async hashrate(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} hashrate()`);
    }
    return EthImpl.zeroHex;
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   */
  getWork(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getWork()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Unsupported methods always return UNSUPPORTED_METHOD error.
   */
  submitHashrate(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} submitHashrate()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  signTransaction(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} signTransaction()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  sign(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} sign()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  sendTransaction(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} sendTransaction()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  protocolVersion(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} protocolVersion()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  coinbase(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} coinbase()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Gets the value from a storage position at the given Ethereum address.
   *
   * @param {string} address The Ethereum address to get the storage value from
   * @param {string} slot The storage slot to get the value from
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @param {string | null} blockNumberOrTagOrHash The block number or tag or hash to get the storage value from
   */
  async getStorageAt(
    address: string,
    slot: string,
    requestDetails: RequestDetails,
    blockNumberOrTagOrHash?: string | null,
  ): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getStorageAt(address=${address}, slot=${slot}, blockNumberOrOrHashTag=${blockNumberOrTagOrHash})`,
      );
    }

    let result = EthImpl.zeroHex32Byte; // if contract or slot not found then return 32 byte 0

    const blockResponse = await this.common.getHistoricalBlockResponse(requestDetails, blockNumberOrTagOrHash, false);
    // To save a request to the mirror node for `latest` and `pending` blocks, we directly return null from `getHistoricalBlockResponse`
    // But if a block number or `earliest` tag is passed and the mirror node returns `null`, we should throw an error.
    if (!this.common.blockTagIsLatestOrPending(blockNumberOrTagOrHash) && blockResponse == null) {
      throw predefined.RESOURCE_NOT_FOUND(`block '${blockNumberOrTagOrHash}'.`);
    }

    const blockEndTimestamp = blockResponse?.timestamp?.to;

    await this.mirrorNodeClient
      .getContractStateByAddressAndSlot(address, slot, requestDetails, blockEndTimestamp)
      .then((response) => {
        if (response !== null && response.state.length > 0) {
          result = response.state[0].value;
        }
      })
      .catch((error: any) => {
        throw this.common.genericErrorHandler(
          error,
          `${requestIdPrefix} Failed to retrieve current contract state for address ${address} at slot=${slot}`,
        );
      });

    return result;
  }

  /**
   * Checks and return correct format from input.
   * @param input
   * @returns
   */
  private static toHex32Byte(input: string): string {
    return input.length === 66 ? input : EthImpl.emptyHex + this.prune0x(input).padStart(64, '0');
  }

  /**
   * Gets the balance of an account as of the given block from the mirror node.
   * Current implementation does not yet utilize blockNumber
   *
   * @param {string} account The account to get the balance from
   * @param {string | null} blockNumberOrTagOrHash The block number or tag or hash to get the balance from
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getBalance(
    account: string,
    blockNumberOrTagOrHash: string | null,
    requestDetails: RequestDetails,
  ): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    const latestBlockTolerance = 1;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getBalance(account=${account}, blockNumberOrTag=${blockNumberOrTagOrHash})`,
      );
    }

    let latestBlock: LatestBlockNumberTimestamp | null | undefined;
    // this check is required, because some tools like Metamask pass for parameter latest block, with a number (ex 0x30ea)
    // tolerance is needed, because there is a small delay between requesting latest block from blockNumber and passing it here
    if (!this.common.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
      let blockHashNumber, isHash;
      const cacheKey = `${constants.CACHE_KEY.ETH_BLOCK_NUMBER}`;
      const blockNumberCached = await this.cacheService.getAsync(cacheKey, EthImpl.ethGetBalance, requestDetails);

      if (blockNumberCached) {
        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(
            `${requestIdPrefix} returning cached value ${cacheKey}:${JSON.stringify(blockNumberCached)}`,
          );
        }
        latestBlock = { blockNumber: blockNumberCached, timeStampTo: '0' };
      } else {
        latestBlock = await this.blockNumberTimestamp(EthImpl.ethGetBalance, requestDetails);
      }

      if (blockNumberOrTagOrHash != null && blockNumberOrTagOrHash.length > 32) {
        isHash = true;
        blockHashNumber = await this.mirrorNodeClient.getBlock(blockNumberOrTagOrHash, requestDetails);
      }

      const currentBlockNumber = isHash ? Number(blockHashNumber.number) : Number(blockNumberOrTagOrHash);

      const blockDiff = Number(latestBlock.blockNumber) - currentBlockNumber;
      if (blockDiff <= latestBlockTolerance) {
        blockNumberOrTagOrHash = EthImpl.blockLatest;
      }

      // If ever we get the latest block from cache, and blockNumberOrTag is not latest, then we need to get the block timestamp
      // This should rarely happen.
      if (blockNumberOrTagOrHash !== EthImpl.blockLatest && latestBlock.timeStampTo === '0') {
        latestBlock = await this.blockNumberTimestamp(EthImpl.ethGetBalance, requestDetails);
      }
    }

    // check cache first
    // create a key for the cache
    const cacheKey = `${constants.CACHE_KEY.ETH_GET_BALANCE}-${account}-${blockNumberOrTagOrHash}`;
    let cachedBalance = await this.cacheService.getAsync(cacheKey, EthImpl.ethGetBalance, requestDetails);
    if (cachedBalance && this.shouldUseCacheForBalance(blockNumberOrTagOrHash)) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestIdPrefix} returning cached value ${cacheKey}:${JSON.stringify(cachedBalance)}`);
      }
      return cachedBalance;
    }

    let blockNumber = null;
    let balanceFound = false;
    let weibars = BigInt(0);
    let mirrorAccount;

    try {
      if (!this.common.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
        const block = await this.common.getHistoricalBlockResponse(requestDetails, blockNumberOrTagOrHash, true);
        if (block) {
          blockNumber = block.number;

          // A blockNumberOrTag has been provided. If it is `latest` or `pending` retrieve the balance from /accounts/{account.id}
          // If the parsed blockNumber is the same as the one from the latest block retrieve the balance from /accounts/{account.id}
          if (latestBlock && block.number !== latestBlock.blockNumber) {
            const latestTimestamp = Number(latestBlock.timeStampTo.split('.')[0]);
            const blockTimestamp = Number(block.timestamp.from.split('.')[0]);
            const timeDiff = latestTimestamp - blockTimestamp;
            // The block is NOT from the last 15 minutes, use /balances rest API
            if (timeDiff > constants.BALANCES_UPDATE_INTERVAL) {
              const balance = await this.mirrorNodeClient.getBalanceAtTimestamp(
                account,
                requestDetails,
                block.timestamp.from,
              );
              balanceFound = true;
              if (balance?.balances?.length) {
                weibars = BigInt(balance.balances[0].balance) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
              }
            }
            // The block is from the last 15 minutes, therefore the historical balance hasn't been imported in the Mirror Node yet
            else {
              let currentBalance = 0;
              let balanceFromTxs = 0;
              mirrorAccount = await this.mirrorNodeClient.getAccountPageLimit(account, requestDetails);
              if (mirrorAccount) {
                if (mirrorAccount.balance) {
                  currentBalance = mirrorAccount.balance.balance;
                }

                // The balance in the account is real time, so we simply subtract the transactions to the block.timestamp.to to get a block relevant balance.
                // needs to be updated below.
                const nextPage: string = mirrorAccount.links.next;

                if (nextPage) {
                  // If we have a pagination link that falls within the block.timestamp.to, we need to paginate to get the transactions for the block.timestamp.to
                  const nextPageParams = new URLSearchParams(nextPage.split('?')[1]);
                  const nextPageTimeMarker = nextPageParams.get('timestamp');
                  // If nextPageTimeMarker is greater than the block.timestamp.to, then we need to paginate to get the transactions for the block.timestamp.to
                  if (nextPageTimeMarker && nextPageTimeMarker?.split(':')[1] >= block.timestamp.to) {
                    const pagedTransactions = await this.mirrorNodeClient.getAccountPaginated(nextPage, requestDetails);
                    mirrorAccount.transactions = mirrorAccount.transactions.concat(pagedTransactions);
                  }
                  // If nextPageTimeMarker is less than the block.timestamp.to, then just run the getBalanceAtBlockTimestamp function in this case as well.
                }

                balanceFromTxs = this.getBalanceAtBlockTimestamp(
                  mirrorAccount.account,
                  mirrorAccount.transactions,
                  block.timestamp.to,
                );

                balanceFound = true;
                weibars = BigInt(currentBalance - balanceFromTxs) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
              }
            }
          }
        }
      }

      if (!balanceFound && !mirrorAccount) {
        // If no balance and no account, then we need to make a request to the mirror node for the account.
        mirrorAccount = await this.mirrorNodeClient.getAccountPageLimit(account, requestDetails);
        // Test if exists here
        if (mirrorAccount !== null && mirrorAccount !== undefined) {
          balanceFound = true;
          weibars = BigInt(mirrorAccount.balance.balance) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF);
        }
      }

      if (!balanceFound) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(
            `${requestIdPrefix} Unable to find account ${account} in block ${JSON.stringify(
              blockNumber,
            )}(${blockNumberOrTagOrHash}), returning 0x0 balance`,
          );
        }
        return EthImpl.zeroHex;
      }

      // save in cache the current balance for the account and blockNumberOrTag
      cachedBalance = numberTo0x(weibars);
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestIdPrefix} Value cached balance ${cachedBalance}`);
      }
      await this.cacheService.set(
        cacheKey,
        cachedBalance,
        EthImpl.ethGetBalance,
        requestDetails,
        this.ethGetBalanceCacheTtlMs,
      );

      return cachedBalance;
    } catch (error: any) {
      throw this.common.genericErrorHandler(
        error,
        `${requestIdPrefix} Error raised during getBalance for account ${account}`,
      );
    }
  }

  /**
   * Gets the smart contract code for the contract at the given Ethereum address.
   *
   * @param {string} address The Ethereum address of the contract
   * @param {string | null} blockNumber The block number to get the contract code from
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getCode(address: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<any | string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (!EthImpl.isBlockParamValid(blockNumber)) {
      throw predefined.UNKNOWN_BLOCK(
        `The value passed is not a valid blockHash/blockNumber/blockTag value: ${blockNumber}`,
      );
    }
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getCode(address=${address}, blockNumber=${blockNumber})`);
    }

    // check for static precompile cases first before consulting nodes
    // this also account for environments where system entities were not yet exposed to the mirror node
    if (address === EthImpl.iHTSAddress) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestIdPrefix} HTS precompile case, return ${EthImpl.invalidEVMInstruction} for byte code`,
        );
      }
      return EthImpl.invalidEVMInstruction;
    }

    const cachedLabel = `getCode.${address}.${blockNumber}`;
    const cachedResponse: string | undefined = await this.cacheService.getAsync(
      cachedLabel,
      EthImpl.ethGetCode,
      requestDetails,
    );
    if (cachedResponse != undefined) {
      return cachedResponse;
    }

    try {
      const result = await this.mirrorNodeClient.resolveEntityType(address, EthImpl.ethGetCode, requestDetails, [
        constants.TYPE_CONTRACT,
        constants.TYPE_TOKEN,
      ]);
      if (result) {
        const blockInfo = await this.common.getHistoricalBlockResponse(requestDetails, blockNumber, true);
        if (!blockInfo || parseFloat(result.entity?.created_timestamp) > parseFloat(blockInfo.timestamp.to)) {
          return EthImpl.emptyHex;
        }
        if (result?.type === constants.TYPE_TOKEN) {
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(`${requestIdPrefix} Token redirect case, return redirectBytecode`);
          }
          return EthImpl.redirectBytecodeAddressReplace(address);
        } else if (result?.type === constants.TYPE_CONTRACT) {
          if (result?.entity.runtime_bytecode !== EthImpl.emptyHex) {
            const prohibitedOpcodes = ['CALLCODE', 'DELEGATECALL', 'SELFDESTRUCT', 'SUICIDE'];
            const opcodes = asm.disassemble(result?.entity.runtime_bytecode);
            const hasProhibitedOpcode =
              opcodes.filter((opcode) => prohibitedOpcodes.indexOf(opcode.opcode.mnemonic) > -1).length > 0;
            if (!hasProhibitedOpcode) {
              await this.cacheService.set(
                cachedLabel,
                result?.entity.runtime_bytecode,
                EthImpl.ethGetCode,
                requestDetails,
              );
              return result?.entity.runtime_bytecode;
            }
          }
        }
      }

      const bytecode = await this.hapiService
        .getSDKClient()
        .getContractByteCode(0, 0, address, EthImpl.ethGetCode, requestDetails);
      return prepend0x(Buffer.from(bytecode).toString('hex'));
    } catch (e: any) {
      if (e instanceof SDKClientError) {
        // handle INVALID_CONTRACT_ID or CONTRACT_DELETED
        if (e.isInvalidContractId() || e.isContractDeleted()) {
          if (this.logger.isLevelEnabled('debug')) {
            this.logger.debug(
              `${requestIdPrefix} Unable to find code for contract ${address} in block "${blockNumber}", returning 0x0, err code: ${e.statusCode}`,
            );
          }
          return EthImpl.emptyHex;
        }

        this.hapiService.decrementErrorCounter(e.statusCode);
        this.logger.error(
          e,
          `${requestIdPrefix} Error raised during getCode for address ${address}, err code: ${e.statusCode}`,
        );
      } else if (e instanceof PrecheckStatusError) {
        if (
          e.status._code === constants.PRECHECK_STATUS_ERROR_STATUS_CODES.INVALID_CONTRACT_ID ||
          e.status._code === constants.PRECHECK_STATUS_ERROR_STATUS_CODES.CONTRACT_DELETED
        ) {
          if (this.logger.isLevelEnabled('debug')) {
            this.logger.debug(
              `${requestIdPrefix} Unable to find code for contract ${address} in block "${blockNumber}", returning 0x0, err code: ${e.message}`,
            );
          }
          return EthImpl.emptyHex;
        }

        this.hapiService.decrementErrorCounter(e.status._code);
        this.logger.error(
          e,
          `${requestIdPrefix} Error raised during getCode for address ${address}, err code: ${e.status._code}`,
        );
      } else {
        this.logger.error(e, `${requestIdPrefix} Error raised during getCode for address ${address}`);
      }

      throw e;
    }
  }

  /**
   * Gets the block with the given hash.
   *
   * @param {string} hash the block hash
   * @param {boolean} showDetails whether to show the details of the block
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getBlockByHash(hash: string, showDetails: boolean, requestDetails: RequestDetails): Promise<Block | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockByHash(hash=${hash}, showDetails=${showDetails})`);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_BY_HASH}_${hash}_${showDetails}`;
    let block = await this.cacheService.getAsync(cacheKey, EthImpl.ethGetBlockByHash, requestDetails);
    if (!block) {
      block = await this.getBlock(hash, showDetails, requestDetails).catch((e: any) => {
        throw this.common.genericErrorHandler(e, `${requestIdPrefix} Failed to retrieve block for hash ${hash}`);
      });
      await this.cacheService.set(cacheKey, block, EthImpl.ethGetBlockByHash, requestDetails);
    }

    return block;
  }

  /**
   * Gets the block by its block number.
   * @param {string} blockNumOrTag Possible values are earliest/pending/latest or hex, and can't be null (validator check).
   * @param {boolean} showDetails whether to show the details of the block
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getBlockByNumber(
    blockNumOrTag: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockByNumber(blockNum=${blockNumOrTag}, showDetails=${showDetails})`);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_BLOCK_BY_NUMBER}_${blockNumOrTag}_${showDetails}`;
    let block = await this.cacheService.getAsync(cacheKey, EthImpl.ethGetBlockByNumber, requestDetails);
    if (!block) {
      block = await this.getBlock(blockNumOrTag, showDetails, requestDetails).catch((e: any) => {
        throw this.common.genericErrorHandler(
          e,
          `${requestIdPrefix} Failed to retrieve block for blockNum ${blockNumOrTag}`,
        );
      });

      if (!this.common.blockTagIsLatestOrPending(blockNumOrTag)) {
        await this.cacheService.set(cacheKey, block, EthImpl.ethGetBlockByNumber, requestDetails);
      }
    }

    return block;
  }

  /**
   * Gets the number of transaction in a block by its block hash.
   *
   * @param {string} hash The block hash
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getBlockTransactionCountByHash(hash: string, requestDetails: RequestDetails): Promise<string | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    this.logger.trace(`${requestIdPrefix} getBlockTransactionCountByHash(hash=${hash}, showDetails=%o)`);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_TRANSACTION_COUNT_BY_HASH}_${hash}`;
    const cachedResponse = await this.cacheService.getAsync(
      cacheKey,
      EthImpl.ethGetTransactionCountByHash,
      requestDetails,
    );
    if (cachedResponse) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} getBlockTransactionCountByHash returned cached response: ${cachedResponse}`,
        );
      }
      return cachedResponse;
    }

    const transactionCount = await this.mirrorNodeClient
      .getBlock(hash, requestDetails)
      .then((block) => EthImpl.getTransactionCountFromBlockResponse(block))
      .catch((e: any) => {
        throw this.common.genericErrorHandler(e, `${requestIdPrefix} Failed to retrieve block for hash ${hash}`);
      });

    await this.cacheService.set(cacheKey, transactionCount, EthImpl.ethGetTransactionCountByHash, requestDetails);
    return transactionCount;
  }

  /**
   * Gets the number of transaction in a block by its block number.
   * @param {string} blockNumOrTag Possible values are earliest/pending/latest or hex
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getBlockTransactionCountByNumber(
    blockNumOrTag: string,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getBlockTransactionCountByNumber(blockNum=${blockNumOrTag}, showDetails=%o)`,
      );
    }
    const blockNum = await this.translateBlockTag(blockNumOrTag, requestDetails);

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_TRANSACTION_COUNT_BY_NUMBER}_${blockNum}`;
    const cachedResponse = await this.cacheService.getAsync(
      cacheKey,
      EthImpl.ethGetTransactionCountByNumber,
      requestDetails,
    );
    if (cachedResponse) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} getBlockTransactionCountByNumber returned cached response: ${cachedResponse}`,
        );
      }
      return cachedResponse;
    }

    const transactionCount = await this.mirrorNodeClient
      .getBlock(blockNum, requestDetails)
      .then((block) => EthImpl.getTransactionCountFromBlockResponse(block))
      .catch((e: any) => {
        throw this.common.genericErrorHandler(
          e,
          `${requestIdPrefix} Failed to retrieve block for blockNum ${blockNum}`,
        );
      });

    await this.cacheService.set(cacheKey, transactionCount, EthImpl.ethGetTransactionCountByNumber, requestDetails);
    return transactionCount;
  }

  /**
   * Gets the transaction in a block by its block hash and transactions index.
   *
   * @param {string} blockHash The block hash
   * @param {string} transactionIndex The transaction index
   * @param {RequestDetails} requestDetails The request details for logging and tracking
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
   * Gets the transaction in a block by its block hash and transactions index.
   *
   * @param {string} blockNumOrTag Possible values are earliest/pending/latest or hex
   * @param {string} transactionIndex The transaction index
   * @param {RequestDetails} requestDetails The request details for logging and tracking
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
    const blockNum = await this.translateBlockTag(blockNumOrTag, requestDetails);

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
   * Gets the number of transactions that have been executed for the given address.
   * This goes to the consensus nodes to determine the ethereumNonce.
   *
   * Queries mirror node for best effort and falls back to consensus node for contracts until HIP 729 is implemented.
   *
   * @param {string} address The account address
   * @param {string | null} blockNumOrTag Possible values are earliest/pending/latest or hex
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getTransactionCount(
    address: string,
    blockNumOrTag: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getTransactionCount(address=${address}, blockNumOrTag=${blockNumOrTag})`);
    }

    // cache considerations for high load
    const cacheKey = `eth_getTransactionCount_${address}_${blockNumOrTag}`;
    let nonceCount = await this.cacheService.getAsync(cacheKey, EthImpl.ethGetTransactionCount, requestDetails);
    if (nonceCount) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestIdPrefix} returning cached value ${cacheKey}:${JSON.stringify(nonceCount)}`);
      }
      return nonceCount;
    }

    const blockNum = Number(blockNumOrTag);
    if (blockNumOrTag) {
      if (blockNum === 0 || blockNum === 1) {
        // previewnet and testnet bug have a genesis blockNumber of 1 but non system account were yet to be created
        return EthImpl.zeroHex;
      } else if (this.common.blockTagIsLatestOrPending(blockNumOrTag)) {
        // if latest or pending, get latest ethereumNonce from mirror node account API
        nonceCount = await this.getAccountLatestEthereumNonce(address, requestDetails);
      } else if (blockNumOrTag === EthImpl.blockEarliest) {
        nonceCount = await this.getAccountNonceForEarliestBlock(requestDetails);
      } else if (!isNaN(blockNum) && blockNumOrTag.length != EthImpl.blockHashLength && blockNum > 0) {
        nonceCount = await this.getAccountNonceForHistoricBlock(address, blockNum, requestDetails);
      } else if (blockNumOrTag.length == EthImpl.blockHashLength && blockNumOrTag.startsWith(EthImpl.emptyHex)) {
        nonceCount = await this.getAccountNonceForHistoricBlock(address, blockNumOrTag, requestDetails);
      } else {
        // return a '-39001: Unknown block' error per api-spec
        throw predefined.UNKNOWN_BLOCK();
      }
    } else {
      // if no block consideration, get latest ethereumNonce from mirror node if account or from consensus node is contract until HIP 729 is implemented
      nonceCount = await this.getAccountLatestEthereumNonce(address, requestDetails);
    }

    const cacheTtl =
      blockNumOrTag === EthImpl.blockEarliest || !isNaN(blockNum)
        ? constants.CACHE_TTL.ONE_DAY
        : this.ethGetTransactionCountCacheTtl; // cache historical values longer as they don't change
    await this.cacheService.set(cacheKey, nonceCount, EthImpl.ethGetTransactionCount, requestDetails, cacheTtl);

    return nonceCount;
  }

  async parseRawTxAndPrecheck(
    transaction: string,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<EthersTransaction> {
    const parsedTx = Precheck.parseTxIfNeeded(transaction);
    try {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} Transaction undergoing prechecks: transaction=${JSON.stringify(
            parsedTx,
          )}`,
        );
      }

      this.precheck.checkSize(transaction);
      await this.precheck.sendRawTransactionCheck(parsedTx, networkGasPriceInWeiBars, requestDetails);
      return parsedTx;
    } catch (e: any) {
      this.logger.error(
        `${requestDetails.formattedRequestId} Precheck failed: transaction=${JSON.stringify(parsedTx)}`,
      );
      throw this.common.genericErrorHandler(e);
    }
  }

  async sendRawTransactionErrorHandler(
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
   * Asynchronously processes a raw transaction by submitting it to the network, managing HFS, polling the MN, handling errors, and returning the transaction hash.
   *
   * @async
   * @param {Buffer} transactionBuffer - The raw transaction data as a buffer.
   * @param {EthersTransaction} parsedTx - The parsed Ethereum transaction object.
   * @param {number} networkGasPriceInWeiBars - The current network gas price in wei bars.
   * @param {RequestDetails} requestDetails - Details of the request for logging and tracking purposes.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash if successful, or a JsonRpcError if an error occurs.
   * @throws {JsonRpcError} If there's an error during transaction processing.
   */
  async sendRawTransactionProcessor(
    transactionBuffer: Buffer,
    parsedTx: EthersTransaction,
    networkGasPriceInWeiBars: number,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    let fileId: FileId | null = null;
    let txSubmitted = false;
    let submittedTransactionId: string = '';
    let sendRawTransactionError: any;

    const requestIdPrefix = requestDetails.formattedRequestId;
    const originalCallerAddress = parsedTx.from?.toString() || '';
    const toAddress = parsedTx.to?.toString() || '';

    this.ethExecutionsCounter
      .labels(
        EthImpl.ethSendRawTransaction,
        parsedTx.data.substring(0, constants.FUNCTION_SELECTOR_CHAR_LENGTH) || '',
        originalCallerAddress,
        toAddress,
      )
      .inc();

    try {
      const sendRawTransactionResult = await this.hapiService
        .getSDKClient()
        .submitEthereumTransaction(
          transactionBuffer,
          EthImpl.ethSendRawTransaction,
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

      sendRawTransactionError = e;
    } finally {
      /**
       *  For transactions of type CONTRACT_CREATE, if the contract's bytecode (calldata) exceeds 5120 bytes, HFS is employed to temporarily store the bytecode on the network.
       *  After transaction execution, whether successful or not, any entity associated with the 'fileId' should be removed from the Hedera network.
       */
      if (fileId) {
        this.hapiService
          .getSDKClient()
          .deleteFile(fileId, requestDetails, EthImpl.ethSendRawTransaction, fileId.toString(), originalCallerAddress)
          .then();
      }
    }

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
   * Submits a transaction to the network for execution.
   *
   * @param {string} transaction - The raw transaction to submit.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash if successful, or a JsonRpcError if an error occurs.
   */
  async sendRawTransaction(transaction: string, requestDetails: RequestDetails): Promise<string | JsonRpcError> {
    const transactionBuffer = Buffer.from(EthImpl.prune0x(transaction), 'hex');

    const networkGasPriceInWeiBars = Utils.addPercentageBufferToGasPrice(
      await this.getFeeWeibars(EthImpl.ethGasPrice, requestDetails),
    );
    const parsedTx = await this.parseRawTxAndPrecheck(transaction, networkGasPriceInWeiBars, requestDetails);

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
   * Execute a free contract call query.
   *
   * @param {IContractCallRequest} call The contract call request data.
   * @param {string | object | null} blockParam either a string (blockNumber or blockTag) or an object (blockHash or blockNumber)
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async call(
    call: IContractCallRequest,
    blockParam: string | object | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    const callData = call.data ? call.data : call.input;
    // log request
    this.logger.info(
      `${requestIdPrefix} call({to=${call.to}, from=${call.from}, data=${callData}, gas=${call.gas}, gasPrice=${call.gasPrice} blockParam=${blockParam}, estimate=${call.estimate})`,
    );
    // log call data size
    const callDataSize = callData ? callData.length : 0;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} call data size: ${callDataSize}`);
    }

    this.ethExecutionsCounter
      .labels(
        EthImpl.ethCall,
        callData?.substring(0, constants.FUNCTION_SELECTOR_CHAR_LENGTH) ?? '',
        call.from || '',
        call.to || '',
      )
      .inc();

    const blockNumberOrTag = await this.extractBlockNumberOrTag(blockParam, requestDetails);
    await this.performCallChecks(call);

    // Get a reasonable value for "gas" if it is not specified.
    const gas = this.getCappedBlockGasLimit(call.gas?.toString(), requestDetails);

    await this.contractCallFormat(call, requestDetails);

    const selector = getFunctionSelector(call.data!);

    // When eth_call is invoked with a selector listed in specialSelectors, it will be routed through the consensus node, regardless of ETH_CALL_DEFAULT_TO_CONSENSUS_NODE.
    // note: this feature is a workaround for when a feature is supported by consensus node but not yet by mirror node.
    // Follow this ticket https://github.com/hashgraph/hedera-json-rpc-relay/issues/2984 to revisit and remove special selectors.
    const specialSelectors = ConfigService.get('ETH_CALL_CONSENSUS_SELECTORS');
    const shouldForceToConsensus = selector !== '' && specialSelectors.includes(selector);

    // ETH_CALL_DEFAULT_TO_CONSENSUS_NODE = false enables the use of Mirror node
    const shouldDefaultToConsensus = ConfigService.get('ETH_CALL_DEFAULT_TO_CONSENSUS_NODE');

    let result: string | JsonRpcError = '';
    try {
      if (shouldForceToConsensus || shouldDefaultToConsensus) {
        result = await this.callConsensusNode(call, gas, requestDetails);
      } else {
        //temporary workaround until precompiles are implemented in Mirror node evm module
        // Execute the call and get the response
        result = await this.callMirrorNode(call, gas, call.value, blockNumberOrTag, requestDetails);
      }

      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(`${requestIdPrefix} eth_call response: ${JSON.stringify(result)}`);
      }

      return result;
    } catch (e: any) {
      this.logger.error(e, `${requestIdPrefix} Failed to successfully submit eth_call`);
      if (e instanceof JsonRpcError) {
        return e;
      }
      return predefined.INTERNAL_ERROR(e.message.toString());
    }
  }

  /**
   * Gets transactions by block hash or block number and index with resolved EVM addresses
   * @param {object} blockParam The block parameter
   * @param {string} blockParam.title Possible values are 'blockHash' and 'blockNumber'
   * @param {string | number} blockParam.value The block hash or block number
   * @param {string} transactionIndex
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Transaction | null>} The transaction or null if not found
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

    const resolvedToAddress = await this.resolveEvmAddress(contractResults[0].to, requestDetails);
    const resolvedFromAddress = await this.resolveEvmAddress(contractResults[0].from, requestDetails, [
      constants.TYPE_ACCOUNT,
    ]);

    return formatContractResult({ ...contractResults[0], from: resolvedFromAddress, to: resolvedToAddress });
  }

  // according to EIP-1898 (https://eips.ethereum.org/EIPS/eip-1898) block param can either be a string (blockNumber or Block Tag) or an object (blockHash or blockNumber)
  private async extractBlockNumberOrTag(
    blockParam: string | object | null,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    if (!blockParam) {
      return null;
    }

    // is an object
    if (typeof blockParam === 'object') {
      // object has property blockNumber, example: { "blockNumber": "0x0" }
      if (blockParam['blockNumber'] != null) {
        return blockParam['blockNumber'];
      }

      if (blockParam['blockHash'] != null) {
        return await this.getBlockNumberFromHash(blockParam['blockHash'], requestDetails);
      }

      // if is an object but doesn't have blockNumber or blockHash, then it's an invalid blockParam
      throw predefined.INVALID_ARGUMENTS('neither block nor hash specified');
    }

    // if blockParam is a string, could be a blockNumber or blockTag or blockHash
    if (blockParam.length > 0) {
      // if string is a blockHash, we return its corresponding blockNumber
      if (EthImpl.isBlockHash(blockParam)) {
        return await this.getBlockNumberFromHash(blockParam, requestDetails);
      } else {
        return blockParam;
      }
    }

    return null;
  }

  private async getBlockNumberFromHash(blockHash: string, requestDetails: RequestDetails): Promise<string> {
    const block = await this.getBlockByHash(blockHash, false, requestDetails);
    if (block != null) {
      return block.number;
    } else {
      throw predefined.RESOURCE_NOT_FOUND(`Block Hash: '${blockHash}'`);
    }
  }

  async callMirrorNode(
    call: IContractCallRequest,
    gas: number | null,
    value: number | string | null | undefined,
    block: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    let callData: IContractCallRequest = {};
    try {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestIdPrefix} Making eth_call on contract ${call.to} with gas ${gas} and call data "${call.data}" from "${call.from}" at blockBlockNumberOrTag: "${block}" using mirror-node.`,
          call.to,
          gas,
          call.data,
          call.from,
          block,
        );
      }
      callData = {
        ...call,
        ...(gas !== null ? { gas } : {}), // Add gas only if it's not null
        ...(value !== null ? { value } : {}),
        estimate: false,
        ...(block !== null ? { block } : {}),
      };

      const contractCallResponse = await this.mirrorNodeClient.postContractCall(callData, requestDetails);
      return contractCallResponse?.result ? prepend0x(contractCallResponse.result) : EthImpl.emptyHex;
    } catch (e: any) {
      if (e instanceof JsonRpcError) {
        return e;
      }

      if (e instanceof MirrorNodeClientError) {
        // Handles mirror node error for missing contract
        if (e.isFailInvalid() || e.isInvalidTransaction()) {
          return EthImpl.emptyHex;
        }

        if (e.isRateLimit()) {
          return predefined.IP_RATE_LIMIT_EXCEEDED(e.data || `Rate limit exceeded on ${EthImpl.ethCall}`);
        }

        if (e.isContractReverted()) {
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(
              `${requestIdPrefix} mirror node eth_call request encountered contract revert. message: ${e.message}, details: ${e.detail}, data: ${e.data}`,
            );
          }
          return predefined.CONTRACT_REVERT(e.detail || e.message, e.data);
        }

        // Temporary workaround until mirror node web3 module implements the support of precompiles
        // If mirror node throws, rerun eth_call and force it to go through the Consensus network
        if (e.isNotSupported() || e.isNotSupportedSystemContractOperaton()) {
          const errorTypeMessage =
            e.isNotSupported() || e.isNotSupportedSystemContractOperaton() ? 'Unsupported' : 'Unhandled';
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(
              `${requestIdPrefix} ${errorTypeMessage} mirror node eth_call request, retrying with consensus node. details: ${JSON.stringify(
                callData,
              )} with error: "${e.message}"`,
            );
          }
          return await this.callConsensusNode(call, gas, requestDetails);
        }
      }

      this.logger.error(e, `${requestIdPrefix} Failed to successfully submit eth_call`);

      return predefined.INTERNAL_ERROR(e.message.toString());
    }
  }

  /**
   * Execute a contract call query to the consensus node
   *
   * @param call The contract call request data
   * @param {number | null} gas The gas to pass for the call
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async callConsensusNode(
    call: any,
    gas: number | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    // Execute the call and get the response
    if (!gas) {
      gas = Number.parseInt(this.defaultGas);
    }

    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${requestIdPrefix} Making eth_call on contract ${call.to} with gas ${gas} and call data "${call.data}" from "${call.from}" using consensus-node.`,
        call.to,
        gas,
        call.data,
        call.from,
      );
    }

    // If "From" is distinct from blank, we check is a valid account
    if (call.from) {
      if (!isValidEthereumAddress(call.from)) {
        throw predefined.NON_EXISTING_ACCOUNT(call.from);
      }
    }

    // Check "To" is a valid Contract or HTS Address
    if (!isValidEthereumAddress(call.to)) {
      throw predefined.INVALID_CONTRACT_ADDRESS(call.to);
    }

    try {
      let data = call.data;
      if (data) {
        data = crypto.createHash('sha1').update(call.data).digest('hex'); // NOSONAR
      }

      const cacheKey = `${constants.CACHE_KEY.ETH_CALL}:${call.from || ''}.${call.to}.${data}`;
      const cachedResponse = await this.cacheService.getAsync(cacheKey, EthImpl.ethCall, requestDetails);

      if (cachedResponse != undefined) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`${requestIdPrefix} eth_call returned cached response: ${cachedResponse}`);
        }
        return cachedResponse;
      }

      const contractCallResponse = await this.hapiService
        .getSDKClient()
        .submitContractCallQueryWithRetry(call.to, call.data, gas, call.from, EthImpl.ethCall, requestDetails);
      if (contractCallResponse) {
        const formattedCallReponse = prepend0x(Buffer.from(contractCallResponse.asBytes()).toString('hex'));

        await this.cacheService.set(
          cacheKey,
          formattedCallReponse,
          EthImpl.ethCall,
          requestDetails,
          this.ethCallCacheTtl,
        );
        return formattedCallReponse;
      }

      return predefined.INTERNAL_ERROR(
        `Invalid contractCallResponse from consensus-node: ${JSON.stringify(contractCallResponse)}`,
      );
    } catch (e: any) {
      this.logger.error(e, `${requestIdPrefix} Failed to successfully submit contractCallQuery`);
      if (e instanceof JsonRpcError) {
        return e;
      }

      if (e instanceof SDKClientError) {
        this.hapiService.decrementErrorCounter(e.statusCode);
      }
      return predefined.INTERNAL_ERROR(e.message.toString());
    }
  }

  /**
   * Perform neccecery checks for the passed call object
   *
   * @param call
   */
  async performCallChecks(call: any): Promise<void> {
    // after this PR https://github.com/hashgraph/hedera-mirror-node/pull/8100 in mirror-node, call.to is allowed to be empty or null
    if (call.to && !isValidEthereumAddress(call.to)) {
      throw predefined.INVALID_CONTRACT_ADDRESS(call.to);
    }
  }

  async resolveEvmAddress(
    address: string,
    requestDetails: RequestDetails,
    searchableTypes = [constants.TYPE_CONTRACT, constants.TYPE_TOKEN, constants.TYPE_ACCOUNT],
  ): Promise<string> {
    if (!address) return address;

    const entity = await this.mirrorNodeClient.resolveEntityType(
      address,
      EthImpl.ethGetCode,
      requestDetails,
      searchableTypes,
      0,
    );
    let resolvedAddress = address;
    if (
      entity &&
      (entity.type === constants.TYPE_CONTRACT || entity.type === constants.TYPE_ACCOUNT) &&
      entity.entity?.evm_address
    ) {
      resolvedAddress = entity.entity.evm_address;
    }

    return resolvedAddress;
  }

  /**
   * Gets a transaction by the provided hash
   *
   * @param hash
   * @param requestDetails
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

      return this.createTransactionFromLog(syntheticLogs[0]);
    }

    const fromAddress = await this.resolveEvmAddress(contractResult.from, requestDetails, [constants.TYPE_ACCOUNT]);
    const toAddress = await this.resolveEvmAddress(contractResult.to, requestDetails);
    contractResult.chain_id = contractResult.chain_id || this.chain;

    return formatContractResult({
      ...contractResult,
      from: fromAddress,
      to: toAddress,
    });
  }

  /**
   * Gets a receipt for a transaction that has already executed.
   *
   * @param {string} hash The transaction hash
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  async getTransactionReceipt(hash: string, requestDetails: RequestDetails): Promise<any> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} getTransactionReceipt(${hash})`);
    }

    const cacheKey = `${constants.CACHE_KEY.ETH_GET_TRANSACTION_RECEIPT}_${hash}`;
    const cachedResponse = await this.cacheService.getAsync(cacheKey, EthImpl.ethGetTransactionReceipt, requestDetails);
    if (cachedResponse) {
      if (this.logger.isLevelEnabled('debug')) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(
            `${requestIdPrefix} getTransactionReceipt returned cached response: ${JSON.stringify(cachedResponse)}`,
          );
        }
      }
      return cachedResponse;
    }

    const receiptResponse = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResult.name,
      [hash, requestDetails],
      requestDetails,
    );

    if (receiptResponse === null || receiptResponse.hash === undefined) {
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
          this.logger.trace(`${requestIdPrefix} no receipt for ${hash}`);
        }
        return null;
      }

      const gasPriceForTimestamp = await this.getCurrentGasPriceForBlock(syntheticLogs[0].blockHash, requestDetails);
      const receipt: ITransactionReceipt = {
        blockHash: syntheticLogs[0].blockHash,
        blockNumber: syntheticLogs[0].blockNumber,
        contractAddress: syntheticLogs[0].address,
        cumulativeGasUsed: EthImpl.zeroHex,
        effectiveGasPrice: gasPriceForTimestamp,
        from: EthImpl.zeroAddressHex,
        gasUsed: EthImpl.zeroHex,
        logs: [syntheticLogs[0]],
        logsBloom: LogsBloomUtils.buildLogsBloom(syntheticLogs[0].address, syntheticLogs[0].topics),
        root: constants.DEFAULT_ROOT_HASH,
        status: EthImpl.oneHex,
        to: syntheticLogs[0].address,
        transactionHash: syntheticLogs[0].transactionHash,
        transactionIndex: syntheticLogs[0].transactionIndex,
        type: null, // null from HAPI transactions
      };

      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestIdPrefix} receipt for ${hash} found in block ${receipt.blockNumber}`);
      }

      await this.cacheService.set(
        cacheKey,
        receipt,
        EthImpl.ethGetTransactionReceipt,
        requestDetails,
        constants.CACHE_TTL.ONE_DAY,
      );
      return receipt;
    } else {
      const effectiveGas = await this.getCurrentGasPriceForBlock(receiptResponse.block_hash, requestDetails);
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

      const contractAddress = this.getContractAddressFromReceipt(receiptResponse);
      const receipt: ITransactionReceipt = {
        blockHash: toHash32(receiptResponse.block_hash),
        blockNumber: numberTo0x(receiptResponse.block_number),
        from: await this.resolveEvmAddress(receiptResponse.from, requestDetails),
        to: await this.resolveEvmAddress(receiptResponse.to, requestDetails),
        cumulativeGasUsed: numberTo0x(receiptResponse.block_gas_used),
        gasUsed: nanOrNumberTo0x(receiptResponse.gas_used),
        contractAddress: contractAddress,
        logs: logs,
        logsBloom: receiptResponse.bloom === EthImpl.emptyHex ? EthImpl.emptyBloom : receiptResponse.bloom,
        transactionHash: toHash32(receiptResponse.hash),
        transactionIndex: numberTo0x(receiptResponse.transaction_index),
        effectiveGasPrice: effectiveGas,
        root: receiptResponse.root || constants.DEFAULT_ROOT_HASH,
        status: receiptResponse.status,
        type: nullableNumberTo0x(receiptResponse.type),
      };

      if (receiptResponse.error_message) {
        receipt.revertReason = isHex(prepend0x(receiptResponse.error_message))
          ? receiptResponse.error_message
          : prepend0x(ASCIIToHex(receiptResponse.error_message));
      }

      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(`${requestIdPrefix} receipt for ${hash} found in block ${receipt.blockNumber}`);
      }

      await this.cacheService.set(
        cacheKey,
        receipt,
        EthImpl.ethGetTransactionReceipt,
        requestDetails,
        constants.CACHE_TTL.ONE_DAY,
      );
      return receipt;
    }
  }

  /**
   * This method retrieves the contract address from the receipt response.
   * If the contract creation is via a system contract, it handles the system contract creation.
   * If not, it returns the address from the receipt response.
   *
   * @param {any} receiptResponse - The receipt response object.
   * @returns {string} The contract address.
   */
  private getContractAddressFromReceipt(receiptResponse: any): string {
    const isCreationViaSystemContract = constants.HTS_CREATE_FUNCTIONS_SELECTORS.includes(
      receiptResponse.function_parameters.substring(0, constants.FUNCTION_SELECTOR_CHAR_LENGTH),
    );

    if (!isCreationViaSystemContract) {
      return receiptResponse.address;
    }

    // Handle system contract creation
    // reason for substring is described in the design doc in this repo: docs/design/hts_address_tx_receipt.md
    const tokenAddress = receiptResponse.call_result.substring(receiptResponse.call_result.length - 40);
    return prepend0x(tokenAddress);
  }

  private async getCurrentGasPriceForBlock(blockHash: string, requestDetails: RequestDetails): Promise<string> {
    const block = await this.getBlockByHash(blockHash, false, requestDetails);
    const timestampDecimal = parseInt(block ? block.timestamp : '0', 16);
    const timestampDecimalString = timestampDecimal > 0 ? timestampDecimal.toString() : '';
    const gasPriceForTimestamp = await this.getFeeWeibars(
      EthImpl.ethGetTransactionReceipt,
      requestDetails,
      timestampDecimalString,
    );

    return numberTo0x(gasPriceForTimestamp);
  }

  private static redirectBytecodeAddressReplace(address: string): string {
    return `${this.redirectBytecodePrefix}${address.slice(2)}${this.redirectBytecodePostfix}`;
  }

  private static prune0x(input: string): string {
    return input.startsWith(EthImpl.emptyHex) ? input.substring(2) : input;
  }

  private static isBlockTagEarliest = (tag: string): boolean => {
    return tag === EthImpl.blockEarliest;
  };

  private static isBlockTagFinalized = (tag: string): boolean => {
    return (
      tag === EthImpl.blockFinalized ||
      tag === EthImpl.blockLatest ||
      tag === EthImpl.blockPending ||
      tag === EthImpl.blockSafe
    );
  };

  private static isBlockNumValid = (num: string) => {
    return /^0[xX]([1-9A-Fa-f]+[0-9A-Fa-f]{0,13}|0)$/.test(num) && Number.MAX_SAFE_INTEGER >= Number(num);
  };

  private static isBlockParamValid = (tag: string | null) => {
    return tag == null || this.isBlockTagEarliest(tag) || this.isBlockTagFinalized(tag) || this.isBlockNumValid(tag);
  };

  private static isBlockHash = (blockHash): boolean => {
    return new RegExp(constants.BLOCK_HASH_REGEX + '{64}$').test(blockHash);
  };

  /**
   * Translates a block tag into a number. 'latest', 'pending', and null are the
   * most recent block, 'earliest' is 0, numbers become numbers.
   *
   * @param tag null, a number, or 'latest', 'pending', or 'earliest'
   * @param requestDetails
   * @private
   */
  private async translateBlockTag(tag: string | null, requestDetails: RequestDetails): Promise<number> {
    if (this.common.blockTagIsLatestOrPending(tag)) {
      return Number(await this.blockNumber(requestDetails));
    } else if (tag === EthImpl.blockEarliest) {
      return 0;
    } else {
      return Number(tag);
    }
  }

  private getCappedBlockGasLimit(gasString: string | undefined, requestDetails: RequestDetails): number | null {
    if (!gasString) {
      // Return null and don't include in the mirror node call, as mirror is doing this estimation on the go.
      return null;
    }

    // Gas limit for `eth_call` is 50_000_000, but the current Hedera network limit is 15_000_000
    // With values over the gas limit, the call will fail with BUSY error so we cap it at 15_000_000
    const gas = Number.parseInt(gasString);
    if (gas > constants.MAX_GAS_PER_SEC) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} eth_call gas amount (${gas}) exceeds network limit, capping gas to ${constants.MAX_GAS_PER_SEC}`,
        );
      }
      return constants.MAX_GAS_PER_SEC;
    }

    return gas;
  }

  populateSyntheticTransactions(
    showDetails: boolean,
    logs: Log[],
    transactionsArray: Array<any>,
    requestDetails: RequestDetails,
  ): Array<any> {
    let filteredLogs: Log[];
    if (showDetails) {
      filteredLogs = logs.filter(
        (log) => !transactionsArray.some((transaction) => transaction.hash === log.transactionHash),
      );
      filteredLogs.forEach((log) => {
        const transaction: Transaction1559 = this.createTransactionFromLog(log);
        transactionsArray.push(transaction);
      });
    } else {
      filteredLogs = logs.filter((log) => !transactionsArray.includes(log.transactionHash));
      filteredLogs.forEach((log) => {
        transactionsArray.push(log.transactionHash);
      });
    }

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Synthetic transaction hashes will be populated in the block response`,
      );
    }

    return transactionsArray;
  }

  /**
   * Gets the block with the given hash.
   * Given an ethereum transaction hash, call the mirror node to get the block info.
   * Then using the block timerange get all contract results to get transaction details.
   * If showDetails is set to true subsequently call mirror node for additional transaction details
   *
   * @param {string} blockHashOrNumber The block hash or block number
   * @param {boolean} showDetails Whether to show transaction details
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   */
  private async getBlock(
    blockHashOrNumber: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block | null> {
    const blockResponse = await this.common.getHistoricalBlockResponse(requestDetails, blockHashOrNumber, true);

    if (blockResponse == null) return null;
    const timestampRange = blockResponse.timestamp;
    const timestampRangeParams = [`gte:${timestampRange.from}`, `lte:${timestampRange.to}`];

    const contractResults = await this.mirrorNodeClient.getContractResultWithRetry(
      this.mirrorNodeClient.getContractResults.name,
      [requestDetails, { timestamp: timestampRangeParams }, undefined],
      requestDetails,
    );
    const gasUsed = blockResponse.gas_used;
    const params = { timestamp: timestampRangeParams };

    // get contract results logs using block timestamp range
    const logs = await this.common.getLogsWithParams(null, params, requestDetails);

    if (contractResults == null && logs.length == 0) {
      // contract result not found
      return null;
    }

    // The consensus timestamp of the block, with the nanoseconds part omitted.
    const timestamp = timestampRange.from.substring(0, timestampRange.from.indexOf('.'));
    if (showDetails && contractResults.length >= this.ethGetTransactionCountMaxBlockRange) {
      throw predefined.MAX_BLOCK_SIZE(blockResponse.count);
    }

    // prepare transactionArray
    let transactionArray: any[] = [];
    for (const contractResult of contractResults) {
      // there are several hedera-specific validations that occur right before entering the evm
      // if a transaction has reverted there, we should not include that tx in the block response
      if (Utils.isRevertedDueToHederaSpecificValidation(contractResult)) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(
            `${requestDetails.formattedRequestId} Transaction with hash ${contractResult.hash} is skipped due to hedera-specific validation failure (${contractResult.result})`,
          );
        }
        continue;
      }
      contractResult.from = await this.resolveEvmAddress(contractResult.from, requestDetails, [constants.TYPE_ACCOUNT]);
      contractResult.to = await this.resolveEvmAddress(contractResult.to, requestDetails);
      contractResult.chain_id = contractResult.chain_id || this.chain;

      transactionArray.push(showDetails ? formatContractResult(contractResult) : contractResult.hash);
    }

    transactionArray = this.populateSyntheticTransactions(showDetails, logs, transactionArray, requestDetails);
    transactionArray = showDetails ? transactionArray : _.uniq(transactionArray);

    const formattedReceipts: IReceiptRootHash[] = ReceiptsRootUtils.buildReceiptRootHashes(
      transactionArray.map((tx) => (showDetails ? tx.hash : tx)),
      contractResults,
      logs,
    );

    const blockHash = toHash32(blockResponse.hash);
    return new Block({
      baseFeePerGas: await this.gasPrice(requestDetails),
      difficulty: EthImpl.zeroHex,
      extraData: EthImpl.emptyHex,
      gasLimit: numberTo0x(constants.BLOCK_GAS_LIMIT),
      gasUsed: numberTo0x(gasUsed),
      hash: blockHash,
      logsBloom: blockResponse.logs_bloom === EthImpl.emptyHex ? EthImpl.emptyBloom : blockResponse.logs_bloom,
      miner: EthImpl.zeroAddressHex,
      mixHash: EthImpl.zeroHex32Byte,
      nonce: EthImpl.zeroHex8Byte,
      number: numberTo0x(blockResponse.number),
      parentHash: blockResponse.previous_hash.substring(0, 66),
      receiptsRoot: await ReceiptsRootUtils.getRootHash(formattedReceipts),
      timestamp: numberTo0x(Number(timestamp)),
      sha3Uncles: EthImpl.emptyArrayHex,
      size: numberTo0x(blockResponse.size | 0),
      stateRoot: constants.DEFAULT_ROOT_HASH,
      totalDifficulty: EthImpl.zeroHex,
      transactions: transactionArray,
      transactionsRoot: transactionArray.length == 0 ? constants.DEFAULT_ROOT_HASH : blockHash,
      uncles: [],
    });
  }

  private createTransactionFromLog(log: Log): Transaction1559 {
    return new Transaction1559({
      accessList: undefined, // we don't support access lists for now
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      chainId: this.chain,
      from: log.address,
      gas: EthImpl.defaultTxGas,
      gasPrice: EthImpl.invalidEVMInstruction,
      hash: log.transactionHash,
      input: EthImpl.zeroHex8Byte,
      maxPriorityFeePerGas: EthImpl.zeroHex,
      maxFeePerGas: EthImpl.zeroHex,
      nonce: nanOrNumberTo0x(0),
      r: EthImpl.zeroHex,
      s: EthImpl.zeroHex,
      to: log.address,
      transactionIndex: log.transactionIndex,
      type: EthImpl.twoHex, // 0x0 for legacy transactions, 0x1 for access list types, 0x2 for dynamic fees.
      v: EthImpl.zeroHex,
      value: EthImpl.oneTwoThreeFourHex,
    });
  }

  private static getTransactionCountFromBlockResponse(block: any): null | string {
    if (block === null || block.count === undefined) {
      // block not found
      return null;
    }

    return numberTo0x(block.count);
  }

  private async getAccountLatestEthereumNonce(address: string, requestDetails: RequestDetails): Promise<string> {
    const accountData = await this.mirrorNodeClient.getAccount(address, requestDetails);
    if (accountData) {
      // with HIP 729 ethereum_nonce should always be 0+ and null. Historical contracts may have a null value as the nonce was not tracked, return default EVM compliant 0x1 in this case
      return accountData.ethereum_nonce !== null ? numberTo0x(accountData.ethereum_nonce) : EthImpl.oneHex;
    }

    return EthImpl.zeroHex;
  }

  /**
   * Returns the number of transactions sent from an address by searching for the ethereum transaction involving the address
   * Remove when https://github.com/hashgraph/hedera-mirror-node/issues/5862 is implemented
   *
   * @param {string} address The account address
   * @param {string | number} blockNumOrHash The block number or hash
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string>} The number of transactions sent from the address
   */
  private async getAcccountNonceFromContractResult(
    address: string,
    blockNumOrHash: string | number,
    requestDetails: RequestDetails,
  ): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    // get block timestamp for blockNum
    const block = await this.mirrorNodeClient.getBlock(blockNumOrHash, requestDetails); // consider caching error responses
    if (block == null) {
      throw predefined.UNKNOWN_BLOCK();
    }

    // get the latest 2 ethereum transactions for the account
    const ethereumTransactions = await this.mirrorNodeClient.getAccountLatestEthereumTransactionsByTimestamp(
      address,
      block.timestamp.to,
      requestDetails,
      2,
    );
    if (ethereumTransactions == null || ethereumTransactions.transactions.length === 0) {
      return EthImpl.zeroHex;
    }

    // if only 1 transaction is returned when asking for 2, then the account has only sent 1 transaction
    // minor optimization to save a call to getContractResult as many accounts serve a single use
    if (ethereumTransactions.transactions.length === 1) {
      return EthImpl.oneHex;
    }

    // get the transaction result for the latest transaction
    const transactionResult = await this.mirrorNodeClient.getContractResult(
      ethereumTransactions.transactions[0].transaction_id,
      requestDetails,
    );
    if (transactionResult == null) {
      throw predefined.RESOURCE_NOT_FOUND(
        `Failed to retrieve contract results for transaction ${ethereumTransactions.transactions[0].transaction_id}`,
      );
    }

    const accountResult = await this.mirrorNodeClient.getAccount(transactionResult.from, requestDetails);

    if (accountResult.evm_address !== address.toLowerCase()) {
      this.logger.warn(
        `${requestIdPrefix} eth_transactionCount for a historical block was requested where address: ${address} was not sender: ${transactionResult.address}, returning latest value as best effort.`,
      );
      return await this.getAccountLatestEthereumNonce(address, requestDetails);
    }

    return numberTo0x(transactionResult.nonce + 1); // nonce is 0 indexed
  }

  private async getAccountNonceForEarliestBlock(requestDetails: RequestDetails): Promise<string> {
    const block = await this.mirrorNodeClient.getEarliestBlock(requestDetails);
    if (block == null) {
      throw predefined.INTERNAL_ERROR('No network blocks found');
    }

    if (block.number <= 1) {
      // if the earliest block is the genesis block or 1 , then the nonce is 0 as only system accounts are present
      return EthImpl.zeroHex;
    }

    // note the mirror node may be a partial one, in which case there may be a valid block with number greater 1.
    throw predefined.INTERNAL_ERROR(`Partial mirror node encountered, earliest block number is ${block.number}`);
  }

  private async getAccountNonceForHistoricBlock(
    address: string,
    blockNumOrHash: number | string,
    requestDetails: RequestDetails,
  ): Promise<string> {
    let getBlock;
    const isParamBlockNum = typeof blockNumOrHash === 'number';

    if (isParamBlockNum && (blockNumOrHash as number) < 0) {
      throw predefined.UNKNOWN_BLOCK();
    }

    if (!isParamBlockNum) {
      getBlock = await this.mirrorNodeClient.getBlock(blockNumOrHash, requestDetails);
    }

    const blockNum = isParamBlockNum ? blockNumOrHash : getBlock.number;

    // check if on latest block, if so get latest ethereumNonce from mirror node account API
    const blockResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails); // consider caching error responses
    if (blockResponse == null || blockResponse.blocks.length === 0) {
      throw predefined.UNKNOWN_BLOCK();
    }

    if (blockResponse.blocks[0].number - blockNum <= this.maxBlockRange) {
      return this.getAccountLatestEthereumNonce(address, requestDetails);
    }

    // if valid block number, get block timestamp
    return await this.getAcccountNonceFromContractResult(address, blockNum, requestDetails);
  }

  /**
   * Retrieves logs based on the provided parameters.
   *
   * The function handles log retrieval as follows:
   *
   * - Using `blockHash`:
   *   - If `blockHash` is provided, logs are retrieved based on the timestamp of the block associated with the `blockHash`.
   *
   * - Without `blockHash`:
   *
   *   - If only `fromBlock` is provided:
   *     - Logs are retrieved from `fromBlock` to the latest block.
   *     - If `fromBlock` does not exist, an empty array is returned.
   *
   *   - If only `toBlock` is provided:
   *     - A predefined error `MISSING_FROM_BLOCK_PARAM` is thrown because `fromBlock` is required.
   *
   *   - If both `fromBlock` and `toBlock` are provided:
   *     - Logs are retrieved from `fromBlock` to `toBlock`.
   *     - If `toBlock` does not exist, an empty array is returned.
   *     - If the timestamp range between `fromBlock` and `toBlock` exceeds 7 days, a predefined error `TIMESTAMP_RANGE_TOO_LARGE` is thrown.
   *
   * @param {string | null} blockHash - The block hash to prioritize log retrieval.
   * @param {string | 'latest'} fromBlock - The starting block for log retrieval.
   * @param {string | 'latest'} toBlock - The ending block for log retrieval.
   * @param {string | string[] | null} address - The address(es) to filter logs by.
   * @param {any[] | null} topics - The topics to filter logs by.
   * @param {RequestDetails} requestDetails - The details of the request.
   * @returns {Promise<Log[]>} - A promise that resolves to an array of logs or an empty array if no logs are found.
   * @throws {Error} Throws specific errors like `MISSING_FROM_BLOCK_PARAM` or `TIMESTAMP_RANGE_TOO_LARGE` when applicable.
   */
  async getLogs(
    blockHash: string | null,
    fromBlock: string | 'latest',
    toBlock: string | 'latest',
    address: string | string[] | null,
    topics: any[] | null,
    requestDetails: RequestDetails,
  ): Promise<Log[]> {
    return this.common.getLogs(blockHash, fromBlock, toBlock, address, topics, requestDetails);
  }

  async maxPriorityFeePerGas(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} maxPriorityFeePerGas()`);
    }
    return EthImpl.zeroHex;
  }

  static isArrayNonEmpty(input: any): boolean {
    return Array.isArray(input) && input.length > 0;
  }

  /**************************************************
   * Returns the difference between the balance of  *
   * the account and the transactions summed up     *
   * to the block number queried.                   *
   *************************************************/
  getBalanceAtBlockTimestamp(account: string, transactions: any[], blockTimestamp: number) {
    return transactions
      .filter((transaction) => {
        return transaction.consensus_timestamp >= blockTimestamp;
      })
      .flatMap((transaction) => {
        return transaction.transfers.filter((transfer) => {
          return transfer.account === account && !transfer.is_approval;
        });
      })
      .map((transfer) => {
        return transfer.amount;
      })
      .reduce((total, amount) => {
        return total + amount;
      }, 0);
  }

  /**
   * Retrieves the current network exchange rate of HBAR to USD in cents.
   *
   * @param {string} requestId - The unique identifier for the request.
   * @returns {Promise<number>} - A promise that resolves to the current exchange rate in cents.
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
}
