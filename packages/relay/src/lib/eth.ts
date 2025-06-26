// SPDX-License-Identifier: Apache-2.0

import EventEmitter from 'events';
import { Logger } from 'pino';

import { Eth } from '../index';
import { MirrorNodeClient } from './clients';
import constants from './constants';
import { cache, RPC_LAYOUT, rpcMethod, rpcParamLayoutConfig, rpcParamValidationRules } from './decorators';
import { JsonRpcError, predefined } from './errors/JsonRpcError';
import { Block, Log, Receipt, Transaction } from './model';
import {
  AccountService,
  BlockService,
  CommonService,
  ContractService,
  FilterService,
  IAccountService,
  IBlockService,
  ICommonService,
  IContractService,
  TransactionService,
} from './services';
import { CACHE_LEVEL, CacheService } from './services/cacheService/cacheService';
import { FeeService } from './services/ethService/feeService/FeeService';
import { IFeeService } from './services/ethService/feeService/IFeeService';
import { ITransactionService } from './services/ethService/transactionService/ITransactionService';
import HAPIService from './services/hapiService/hapiService';
import {
  IContractCallRequest,
  IFeeHistory,
  IGetLogsParams,
  INewFilterParams,
  ITransactionReceipt,
  RequestDetails,
} from './types';
import { ParamType } from './types/validation';

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
  /**
   * The Account Service implementation that takes care of all account API operations.
   * @private
   */
  private readonly accountService: IAccountService;

  /**
   * The Block Service implementation that takes care of all block API operations.
   * @private
   */
  private readonly blockService: IBlockService;

  /**
   * The ID of the chain, as a hex string, as it would be returned in a JSON-RPC call.
   * @private
   */
  private readonly chain: string;

  /**
   * The Common Service implementation that contains logic shared by other services.
   * @private
   */
  private readonly common: ICommonService;

  /**
   * The ContractService implementation that takes care of all contract related operations.
   * @private
   */
  private readonly contractService: IContractService;

  /**
   * Event emitter for publishing and subscribing to events.
   * @private
   */
  private readonly eventEmitter: EventEmitter;

  /**
   * The Fee Service implementation that takes care of all fee API operations.
   * @private
   */
  private readonly feeService: IFeeService;

  /**
   * The Filter Service implementation that takes care of all filter API operations.
   * @private
   */
  private readonly filterService: FilterService;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * The Transaction Service implementation that handles all transaction-related operations.
   * @private
   */
  private readonly transactionService: ITransactionService;

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
    cacheService: CacheService,
    eventEmitter: EventEmitter,
  ) {
    this.chain = chain;
    this.logger = logger;
    this.common = new CommonService(mirrorNodeClient, logger, cacheService);
    this.filterService = new FilterService(mirrorNodeClient, logger, cacheService, this.common);
    this.feeService = new FeeService(mirrorNodeClient, this.common, logger);
    this.contractService = new ContractService(cacheService, this.common, hapiService, logger, mirrorNodeClient);
    this.accountService = new AccountService(cacheService, this.common, logger, mirrorNodeClient);
    this.blockService = new BlockService(cacheService, chain, this.common, mirrorNodeClient, logger);
    this.eventEmitter = eventEmitter;
    this.transactionService = new TransactionService(
      cacheService,
      chain,
      this.common,
      eventEmitter,
      hapiService,
      logger,
      mirrorNodeClient,
    );
  }

  /**
   * This method is implemented to always return an empty array. This is in alignment
   * with the behavior of Infura.
   *
   * @rpcMethod Exposed as eth_accounts RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {never[]} An empty array.
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  public accounts(requestDetails: RequestDetails): never[] {
    return this.contractService.accounts(requestDetails);
  }

  /**
   * Retrieves the fee history for a specified block range.
   *
   * @rpcMethod Exposed as eth_feeHistory RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {number} blockCount - The number of blocks to include in the fee history.
   * @param {string} newestBlock - The block number or tag of the newest block to include in the fee history.
   * @param {Array<number> | null} rewardPercentiles - An array of percentiles for reward calculation or null if not required.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IFeeHistory | JsonRpcError>} A promise that resolves to the fee history or a JsonRpcError if an error occurs.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.HEX, required: true },
    1: { type: ParamType.BLOCK_NUMBER, required: true },
    2: { type: ParamType.ARRAY, required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [Number(params[0]), params[1], params[2]]))
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '1', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
    ttl: constants.CACHE_TTL.FIFTEEN_MINUTES,
  })
  async feeHistory(
    blockCount: number,
    newestBlock: string,
    rewardPercentiles: Array<number> | null,
    requestDetails: RequestDetails,
  ): Promise<IFeeHistory | JsonRpcError> {
    return this.feeService.feeHistory(blockCount, newestBlock, rewardPercentiles, requestDetails);
  }

  /**
   * Gets the most recent block number.
   *
   * @rpcMethod Exposed as eth_blockNumber RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<string>} A promise that resolves to the most recent block number in hexadecimal format.
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    ttl: 500,
  })
  async blockNumber(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} blockNumber()`);
    }
    return await this.common.getLatestBlockNumber(requestDetails);
  }

  /**
   * Gets the chain ID. This is a static value, in that it always returns
   * the same value. This can be specified via an environment variable
   * `CHAIN_ID`.
   *
   * @rpcMethod Exposed as eth_chainId RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {string} The chain ID as a string.
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  chainId(requestDetails: RequestDetails): string {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} chainId()`);
    }
    return this.chain;
  }

  /**
   * Estimates the amount of gas required to execute a contract call.
   *
   * @rpcMethod Exposed as eth_estimateGas RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {IContractCallRequest} transaction - The transaction data for the contract call.
   * @param {string | null} _blockParam - Optional block parameter to specify the block to estimate gas for.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the estimated gas in hexadecimal format or a JsonRpcError.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.TRANSACTION, required: true },
    1: { type: ParamType.BLOCK_NUMBER, required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[0], params[1]]))
  async estimateGas(
    transaction: IContractCallRequest,
    _blockParam: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    // Removing empty '0x' data parameter sent by Metamask
    if (transaction.data === '0x') {
      delete transaction.data;
    }

    const callData = transaction.data || transaction.input;
    const callDataSize = callData?.length || 0;

    if (callDataSize >= constants.FUNCTION_SELECTOR_CHAR_LENGTH) {
      this.eventEmitter.emit(constants.EVENTS.ETH_EXECUTION, {
        method: constants.ETH_ESTIMATE_GAS,
        requestDetails: requestDetails,
      });
    }

    return await this.contractService.estimateGas(transaction, _blockParam, requestDetails);
  }

  /**
   * Retrieves the current network gas price in weibars.
   *
   * @returns {Promise<string>} The current gas price in weibars as a hexadecimal string.
   * @throws Will throw an error if unable to retrieve the gas price.
   * @param requestDetails
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    ttl: constants.CACHE_TTL.FIFTEEN_MINUTES,
  })
  async gasPrice(requestDetails: RequestDetails): Promise<string> {
    return this.common.gasPrice(requestDetails);
  }

  /**
   * Gets whether this "Ethereum client" is a miner. We don't mine, so this always returns false.
   *
   * @rpcMethod Exposed as eth_mining RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<boolean>} Always returns false.
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async mining(requestDetails: RequestDetails): Promise<boolean> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} mining()`);
    }
    return false;
  }

  /**
   * Creates a new filter object based on filter options to notify when the state changes (logs).
   *
   * @todo fix param schema
   * @rpcMethod Exposed as eth_newFilter RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {INewFilterParams} params - The parameters for the new filter
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<string>} A filter ID that can be used to query for changes
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.FILTER, required: true },
  })
  async newFilter(params: INewFilterParams, requestDetails: RequestDetails): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} newFilter(params=${JSON.stringify(params)})`);
    }
    return this.filterService.newFilter(params, requestDetails);
  }

  /**
   * Returns an array of all logs matching the filter with the given ID.
   *
   * @rpcMethod Exposed as eth_getFilterLogs RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} filterId - The filter ID
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<Log[]>} Array of log objects matching the filter criteria
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.HEX, required: true },
  })
  async getFilterLogs(filterId: string, requestDetails: RequestDetails): Promise<Log[]> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getFilterLogs(${filterId})`);
    }
    return this.filterService.getFilterLogs(filterId, requestDetails);
  }

  /**
   * Polling method for a filter, which returns an array of events that occurred since the last poll.
   *
   * @rpcMethod Exposed as eth_getFilterChanges RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} filterId - The filter ID
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<string[] | Log[]>} Array of new logs or block hashes depending on the filter type
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.HEX, required: true },
  })
  async getFilterChanges(filterId: string, requestDetails: RequestDetails): Promise<string[] | Log[]> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getFilterChanges(${filterId})`);
    }
    return this.filterService.getFilterChanges(filterId, requestDetails);
  }

  /**
   * Creates a filter in the node to notify when a new block arrives.
   *
   * @rpcMethod Exposed as eth_newBlockFilter RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<string>} A filter ID that can be used to check for new blocks
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async newBlockFilter(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} newBlockFilter()`);
    }
    return this.filterService.newBlockFilter(requestDetails);
  }

  /**
   * Uninstalls a filter with the given ID.
   *
   * @rpcMethod Exposed as eth_uninstallFilter RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} filterId - The filter ID to uninstall
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<boolean>} True if the filter was successfully uninstalled, false otherwise
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.HEX, required: true },
  })
  async uninstallFilter(filterId: string, requestDetails: RequestDetails): Promise<boolean> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} uninstallFilter(${filterId})`);
    }
    return this.filterService.uninstallFilter(filterId, requestDetails);
  }

  /**
   * Creates a filter in the node to notify when new pending transactions arrive.
   * This method is not supported and returns an error.
   *
   * @rpcMethod Exposed as eth_newPendingTransactionFilter RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<JsonRpcError>} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async newPendingTransactionFilter(requestDetails: RequestDetails): Promise<JsonRpcError> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} newPendingTransactionFilter()`);
    }
    return this.filterService.newPendingTransactionFilter();
  }

  /**
   * TODO Needs docs, or be removed?
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async submitWork(requestDetails: RequestDetails): Promise<boolean> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} submitWork()`);
    }
    return false;
  }

  /**
   * TODO Needs docs, or be removed?
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async syncing(requestDetails: RequestDetails): Promise<boolean> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} syncing()`);
    }
    return false;
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   *
   * @rpcMethod Exposed as eth_getUncleByBlockHashAndIndex RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<null>} Always returns null
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async getUncleByBlockHashAndIndex(requestDetails: RequestDetails): Promise<null> {
    return this.blockService.getUncleByBlockHashAndIndex(requestDetails);
  }

  /**
   * Always returns null. There are no uncles in Hedera.
   *
   * @rpcMethod Exposed as eth_getUncleByBlockNumberAndIndex RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<null>} Always returns null
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async getUncleByBlockNumberAndIndex(requestDetails: RequestDetails): Promise<null> {
    return this.blockService.getUncleByBlockNumberAndIndex(requestDetails);
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   *
   * @rpcMethod Exposed as eth_getUncleCountByBlockHash RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<string>} Always returns '0x0'
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async getUncleCountByBlockHash(requestDetails: RequestDetails): Promise<string> {
    return this.blockService.getUncleCountByBlockHash(requestDetails);
  }

  /**
   * Always returns '0x0'. There are no uncles in Hedera.
   *
   * @rpcMethod Exposed as eth_getUncleCountByBlockNumber RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {Promise<string>} Always returns '0x0'
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async getUncleCountByBlockNumber(requestDetails: RequestDetails): Promise<string> {
    return this.blockService.getUncleCountByBlockNumber(requestDetails);
  }

  /**
   * TODO Needs docs, or be removed?
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async hashrate(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} hashrate()`);
    }
    return constants.ZERO_HEX;
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_getWork RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  getWork(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getWork()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Unsupported methods always return UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_submitHashrate RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  submitHashrate(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} submitHashrate()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_signTransaction RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  signTransaction(requestDetails: RequestDetails): JsonRpcError {
    return this.transactionService.signTransaction(requestDetails);
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_sign RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  sign(requestDetails: RequestDetails): JsonRpcError {
    return this.transactionService.sign(requestDetails);
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_sendTransaction RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  sendTransaction(requestDetails: RequestDetails): JsonRpcError {
    return this.transactionService.sendTransaction(requestDetails);
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_protocolVersion RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  protocolVersion(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} protocolVersion()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_coinbase RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  coinbase(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} coinbase()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_blobBaseFee RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  blobBaseFee(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} blobBaseFee()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Gets the value from a storage position at the given Ethereum address.
   *
   * @rpcMethod Exposed as eth_getStorageAt RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} address - The Ethereum address to get the storage value from
   * @param {string} slot - The storage slot to get the value from
   * @param {string | null} blockNumberOrTagOrHash - The block number or tag or hash to get the storage value from
   * @param {RequestDetails} requestDetails - The request details for logging and tracking
   * @returns {Promise<string>} A promise that resolves to the storage value as a hexadecimal string
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.ADDRESS, required: true },
    1: { type: ParamType.HEX64, required: true },
    2: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: false },
  })
  @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[0], params[1], params[2]]))
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '2', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getStorageAt(
    address: string,
    slot: string,
    blockNumberOrTagOrHash: string | null,
    requestDetails: RequestDetails,
  ): Promise<string> {
    return this.contractService.getStorageAt(address, slot, blockNumberOrTagOrHash, requestDetails);
  }

  /**
   * Gets the balance of an account as of the given block from the mirror node.
   * Current implementation does not yet utilize blockNumber
   *
   * @rpcMethod Exposed as eth_getBalance RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} account The account to get the balance from
   * @param {string | null} blockNumberOrTagOrHash The block number or tag or hash to get the balance from
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<string>} A promise that resolves to the balance of the account in hexadecimal format.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.ADDRESS, required: true },
    1: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '1', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getBalance(
    account: string,
    blockNumberOrTagOrHash: string | null,
    requestDetails: RequestDetails,
  ): Promise<string> {
    return this.accountService.getBalance(account, blockNumberOrTagOrHash, requestDetails);
  }

  /**
   * Retrieves the smart contract code for the contract at the specified Ethereum address.
   *
   * @rpcMethod Exposed as the eth_getCode RPC endpoint.
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} address - The Ethereum address of the contract.
   * @param {string | null} blockNumber - The block number from which to retrieve the contract code.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<string>} A promise that resolves to the contract code in hexadecimal format, or an empty hex string if not found.
   * @throws {Error} Throws an error if the block number is invalid or if there is an issue retrieving the contract code.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.ADDRESS, required: true },
    1: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '1', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  public async getCode(
    address: string,
    blockNumber: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    return this.contractService.getCode(address, blockNumber, requestDetails);
  }

  /**
   * Retrieves the block associated with the specified hash.
   *
   * @rpcMethod Exposed as eth_getBlockByHash RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} hash - The block hash to retrieve.
   * @param {boolean} showDetails - Indicates whether to include detailed information about the block.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking purposes.
   * @returns {Promise<Block | null>} A promise that resolves to the block object or null if the block is not found.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_HASH, required: true },
    1: { type: ParamType.BOOLEAN, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1))
  async getBlockByHash(hash: string, showDetails: boolean, requestDetails: RequestDetails): Promise<Block | null> {
    return this.blockService.getBlockByHash(hash, showDetails, requestDetails);
  }

  /**
   * Retrieves the number of transactions in a block by its block hash.
   *
   * @rpcMethod Exposed as eth_getBlockTransactionCountByHash RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} hash - The block hash.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking purposes.
   * @returns {Promise<string | null>} A promise that resolves to the number of transactions in the block as a hexadecimal string, or null if the block is not found.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_HASH, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1))
  async getBlockTransactionCountByHash(hash: string, requestDetails: RequestDetails): Promise<string | null> {
    return this.blockService.getBlockTransactionCountByHash(hash, requestDetails);
  }

  /**
   * Retrieves the number of transactions in a block by its block number.
   *
   * @rpcMethod Exposed as eth_getBlockTransactionCountByNumber RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockNumOrTag - The block number or tag. Possible values are 'earliest', 'pending', 'latest', or a hexadecimal block number.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking purposes.
   * @returns {Promise<string | null>} A promise that resolves to the number of transactions in the block as a hexadecimal string, or null if the block is not found.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_NUMBER, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getBlockTransactionCountByNumber(
    blockNumOrTag: string,
    requestDetails: RequestDetails,
  ): Promise<string | null> {
    return this.blockService.getBlockTransactionCountByNumber(blockNumOrTag, requestDetails);
  }

  /**
   * Retrieves a transaction from a block by its block hash and transaction index.
   *
   * @rpcMethod Exposed as eth_getTransactionByBlockHashAndIndex RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockHash - The hash of the block containing the transaction.
   * @param {string} transactionIndex - The index of the transaction within the block.
   * @param {RequestDetails} requestDetails - Details of the request for logging and tracking purposes.
   * @returns {Promise<Transaction | null>} A promise that resolves to the transaction object if found, or null if not found.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_HASH, required: true },
    1: { type: ParamType.HEX, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1))
  async getTransactionByBlockHashAndIndex(
    blockHash: string,
    transactionIndex: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null> {
    return await this.transactionService.getTransactionByBlockHashAndIndex(blockHash, transactionIndex, requestDetails);
  }

  /**
   * Gets the transaction in a block by its block hash and transactions index.
   *
   * @rpcMethod Exposed as eth_getTransactionByBlockNumberAndIndex RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockNumOrTag - The block number or tag to retrieve the transaction from. Possible values are 'earliest', 'pending', 'latest', or a hexadecimal block hash.
   * @param {string} transactionIndex - The index of the transaction within the block.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking purposes.
   * @returns {Promise<Transaction | null>} A promise that resolves to the transaction object if found, or null if not found.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_NUMBER, required: true },
    1: { type: ParamType.HEX, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getTransactionByBlockNumberAndIndex(
    blockNumOrTag: string,
    transactionIndex: string,
    requestDetails: RequestDetails,
  ): Promise<Transaction | null> {
    return await this.transactionService.getTransactionByBlockNumberAndIndex(
      blockNumOrTag,
      transactionIndex,
      requestDetails,
    );
  }

  /**
   * Retrieves the block associated with the specified block number or tag.
   *
   * @rpcMethod Exposed as eth_getBlockByNumber RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} blockNumOrTag - The block number or tag. Possible values include 'earliest', 'pending', 'latest', or a hexadecimal block number. This parameter cannot be null.
   * @param {boolean} showDetails - Indicates whether to include detailed information about the block.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking purposes.
   * @returns {Promise<Block | null>} A promise that resolves to the block object or null if the block is not found.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_NUMBER, required: true },
    1: { type: ParamType.BOOLEAN, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getBlockByNumber(
    blockNumOrTag: string,
    showDetails: boolean,
    requestDetails: RequestDetails,
  ): Promise<Block | null> {
    return this.blockService.getBlockByNumber(blockNumOrTag, showDetails, requestDetails);
  }

  /**
   * Gets the number of transactions that have been executed for the given address.
   * This goes to the consensus nodes to determine the ethereumNonce.
   *
   * Queries mirror node for best effort and falls back to consensus node for contracts until HIP 729 is implemented.
   *
   * @rpcMethod Exposed as the eth_getTransactionCount RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} address - The account address for which to retrieve the transaction count.
   * @param {string} blockNumOrTag - Possible values are 'earliest', 'pending', 'latest', or a block hash in hexadecimal format.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction count in hexadecimal format or a JsonRpcError.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.ADDRESS, required: true },
    1: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '1', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  async getTransactionCount(
    address: string,
    blockNumOrTag: string,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    return this.accountService.getTransactionCount(address, blockNumOrTag, requestDetails);
  }

  /**
   * Submits a transaction to the network for execution.
   *
   * @rpcMethod Exposed as eth_sendRawTransaction RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} transaction - The raw transaction to submit.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction hash if successful, or a JsonRpcError if an error occurs.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.HEX, required: true },
  })
  async sendRawTransaction(transaction: string, requestDetails: RequestDetails): Promise<string | JsonRpcError> {
    return await this.transactionService.sendRawTransaction(transaction, requestDetails);
  }

  /**
   * Execute a free contract call query.
   *
   * @rpcMethod Exposed as eth_call RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {IContractCallRequest} call - The contract call request data.
   * @param {string | object | null} blockParam - Either a string (blockNumber or blockTag) or an object (blockHash or blockNumber).
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the result of the contract call or a JsonRpcError if an error occurs.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.TRANSACTION, required: true },
    1: { type: ParamType.BLOCK_PARAMS, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '1', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  public async call(
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
    // log request info and increment metrics counter
    const callDataSize = callData ? callData.length : 0;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestIdPrefix} call data size: ${callDataSize}`);
    }

    this.eventEmitter.emit(constants.EVENTS.ETH_EXECUTION, {
      method: 'eth_call',
      requestDetails: requestDetails,
    });

    return this.contractService.call(call, blockParam, requestDetails);
  }

  /**
   * Gets a transaction by the provided hash
   *
   * @rpcMethod Exposed as eth_getTransactionByHash RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} hash - The hash of the transaction to retrieve.
   * @param {RequestDetails} requestDetails - Details of the request for logging and tracking purposes.
   * @returns {Promise<Transaction | null>} A promise that resolves to the transaction object if found, or null if not found.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.TRANSACTION_HASH, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1))
  async getTransactionByHash(hash: string, requestDetails: RequestDetails): Promise<Transaction | null> {
    return await this.transactionService.getTransactionByHash(hash, requestDetails);
  }

  /**
   * Gets a receipt for a transaction that has already executed.
   *
   * @rpcMethod Exposed as eth_getTransactionReceipt RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} hash - The hash of the transaction.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking purposes.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.TRANSACTION_HASH, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1))
  async getTransactionReceipt(hash: string, requestDetails: RequestDetails): Promise<any> {
    return await this.transactionService.getTransactionReceipt(hash, requestDetails);
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
   * @rpcMethod Exposed as eth_getLogs RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {IGetLogsParams} params - The parameters for the getLogs method.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<Log[]>} A promise that resolves to an array of logs or an empty array if no logs are found.
   * @throws {Error} Throws specific errors like `MISSING_FROM_BLOCK_PARAM` or `TIMESTAMP_RANGE_TOO_LARGE` when applicable.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.FILTER, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipNamedParams: [
      {
        index: '0',
        fields: [
          { name: 'fromBlock', value: constants.NON_CACHABLE_BLOCK_PARAMS },
          { name: 'toBlock', value: constants.NON_CACHABLE_BLOCK_PARAMS },
        ],
      },
    ],
  })
  public async getLogs(params: IGetLogsParams, requestDetails: RequestDetails): Promise<Log[]> {
    return this.contractService.getLogs(params, requestDetails);
  }

  /**
   * Get the priority fee needed to be included in a block.
   * Since Hedera does not have this concept, this method will return a static response.
   *
   * @rpcMethod Exposed as eth_maxPriorityFeePerGas RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<string>} A promise that resolves to "0x0".
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  async maxPriorityFeePerGas(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} maxPriorityFeePerGas()`);
    }
    return constants.ZERO_HEX;
  }

  /**
   * Gets all transaction receipts for a block by block hash or block number.
   *
   * @rpcMethod Exposed as eth_getBlockReceipts RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string } blockHashOrBlockNumber The block hash, block number, or block tag
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<ITransactionReceipt[] | null>} Array of transaction receipts for the block or null if block not found
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: true },
  })
  @cache(CacheService.getInstance(CACHE_LEVEL.L1), {
    skipParams: [{ index: '0', value: constants.NON_CACHABLE_BLOCK_PARAMS }],
  })
  public async getBlockReceipts(
    blockHashOrBlockNumber: string,
    requestDetails: RequestDetails,
  ): Promise<ITransactionReceipt[] | null> {
    return await this.blockService.getBlockReceipts(blockHashOrBlockNumber, requestDetails);
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_getWork RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  getProof(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} getProof()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }

  /**
   * Always returns UNSUPPORTED_METHOD error.
   *
   * @rpcMethod Exposed as eth_createAccessList RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - Details about the request for logging and tracking
   * @returns {JsonRpcError} An error indicating the method is not supported
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
  createAccessList(requestDetails: RequestDetails): JsonRpcError {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} createAccessList()`);
    }
    return predefined.UNSUPPORTED_METHOD;
  }
}
