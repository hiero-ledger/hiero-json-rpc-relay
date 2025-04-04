// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { FileId } from '@hashgraph/sdk';
import { Transaction as EthersTransaction } from 'ethers';
import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import {
  ASCIIToHex,
  formatTransactionIdWithoutQueryParams,
  isHex,
  nanOrNumberTo0x,
  nullableNumberTo0x,
  numberTo0x,
  parseNumericEnvVar,
  prepend0x,
  toHash32,
  trimPrecedingZeros,
} from '../formatters';
import { Eth } from '../index';
import { LogsBloomUtils } from '../logsBloomUtils';
import { Utils } from '../utils';
import { MirrorNodeClient } from './clients';
import constants from './constants';
import { RPC_LAYOUT, rpcMethod, rpcParamLayoutConfig, rpcParamValidationRules } from './decorators';
import { JsonRpcError, predefined } from './errors/JsonRpcError';
import { MirrorNodeClientError } from './errors/MirrorNodeClientError';
import { SDKClientError } from './errors/SDKClientError';
import { Block, Log, Receipt, Transaction, Transaction1559 } from './model';
import { Precheck } from './precheck';
import { BlockService, CommonService, ContractService, FilterService, IBlockService, ICommonService } from './services';
import { AccountService } from './services/accountService';
import { IAccountService } from './services/accountService/IAccountService';
import { CacheService } from './services/cacheService/cacheService';
import { IContractService } from './services/contractService/IContractService';
import { FeeService } from './services/feeService';
import HAPIService from './services/hapiService/hapiService';
import {
  IContractCallRequest,
  IContractCallResponse,
  IFeeHistory,
  IGetLogsParams,
  INewFilterParams,
  ITransactionReceipt,
  RequestDetails,
} from './types';
import { ParamType } from './types/validation';
const _ = require('lodash');

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
  static zeroHex = '0x0';
  static oneHex = '0x1';
  static twoHex = '0x2';
  static oneTwoThreeFourHex = '0x1234';
  static zeroHex8Byte = '0x0000000000000000';
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
  static blockHashLength = 66;

  // endpoint callerNames
  static ethBlockByNumber = 'eth_blockNumber';
  static ethEstimateGas = 'eth_estimateGas';
  static ethFeeHistory = 'eth_feeHistory';
  static ethGasPrice = 'eth_gasPrice';
  static ethGetBalance = 'eth_getBalance';
  static ethGetBlockReceipts = 'eth_getBlockReceipts';
  static ethGetBlockByHash = 'eth_GetBlockByHash';
  static ethGetBlockByNumber = 'eth_GetBlockByNumber';
  static ethGetTransactionByHash = 'eth_GetTransactionByHash';
  static ethGetTransactionCount = 'eth_getTransactionCount';
  static ethGetTransactionCountByHash = 'eth_GetTransactionCountByHash';
  static ethGetTransactionCountByNumber = 'eth_GetTransactionCountByNumber';
  static ethGetTransactionReceipt = 'eth_GetTransactionReceipt';
  static ethSendRawTransaction = 'eth_sendRawTransaction';

  // block constants
  static blockLatest = 'latest';
  static blockEarliest = 'earliest';
  static blockPending = 'pending';
  static blockSafe = 'safe';
  static blockFinalized = 'finalized';

  /**
   * Overrideable options used when initializing.
   *
   * @private
   */
  private readonly defaultGas = numberTo0x(parseNumericEnvVar('TX_DEFAULT_GAS', 'TX_DEFAULT_GAS_DEFAULT'));
  private readonly contractCallAverageGas = numberTo0x(constants.TX_CONTRACT_CALL_AVERAGE_GAS);
  private readonly ethGetTransactionCountMaxBlockRange = ConfigService.get('ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE');
  private readonly estimateGasThrows = ConfigService.get('ESTIMATE_GAS_THROWS');

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
  private readonly common: ICommonService;

  /**
   * The Filter Service implementation that takes care of all filter API operations.
   */
  private readonly filterService: FilterService;

  /**
   * The Block Service implementation that takes care of all block API operations.
   */
  private readonly blockService: IBlockService;

  /**
   * The Fee Service implementation that takes care of all fee API operations.
   */
  private readonly feeService: FeeService;

  /**
   * The ContractService implementation that takes care of all contract related operations.
   */
  private readonly contractService: IContractService;

  /**
   * The Account Service implementation that takes care of all account API operations.
   */
  private readonly accountService: IAccountService;

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
    this.common = new CommonService(mirrorNodeClient, logger, cacheService, hapiService);
    this.filterService = new FilterService(mirrorNodeClient, logger, cacheService, this.common);
    this.feeService = new FeeService(mirrorNodeClient, this.common, logger, cacheService);
    this.contractService = new ContractService(cacheService, this.common, hapiService, logger, mirrorNodeClient);
    this.accountService = new AccountService(cacheService, this.common, logger, mirrorNodeClient);
    this.blockService = new BlockService(cacheService, chain, this.common, mirrorNodeClient, logger);
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

    const requestIdPrefix = requestDetails.formattedRequestId;
    const callData = transaction.data || transaction.input;
    const callDataSize = callData?.length || 0;

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
    await this.common.contractCallFormat(transaction, requestDetails);
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
      if (await this.common.getAccount(transaction.to!, requestDetails)) {
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
   * Retrieves the current network gas price in weibars.
   *
   * @rpcMethod Exposed as eth_gasPrice RPC endpoint
   * @rpcParamLayoutConfig decorated method parameter layout
   *
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<string>} The current gas price in weibars as a hexadecimal string.
   * @throws Will throw an error if unable to retrieve the gas price.
   * @param requestDetails
   */
  @rpcMethod
  @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
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
    return EthImpl.zeroHex;
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
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} signTransaction()`);
    }
    return predefined.UNSUPPORTED_METHOD;
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
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} sign()`);
    }
    return predefined.UNSUPPORTED_METHOD;
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
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} sendTransaction()`);
    }
    return predefined.UNSUPPORTED_METHOD;
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
  async getStorageAt(
    address: string,
    slot: string,
    blockNumberOrTagOrHash: string | null,
    requestDetails: RequestDetails,
  ): Promise<string> {
    const requestIdPrefix = requestDetails.formattedRequestId;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} getStorageAt(address=${address}, slot=${slot}, blockNumberOrOrHashTag=${blockNumberOrTagOrHash})`,
      );
    }

    let result = CommonService.zeroHex32Byte; // if contract or slot not found then return 32 byte 0

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
  public async getCode(address: string, blockNumber: string | null, requestDetails: RequestDetails): Promise<string> {
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
   * @param {string | null} blockNumOrTag - Possible values are 'earliest', 'pending', 'latest', or a block hash in hexadecimal format.
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking.
   * @returns {Promise<string | JsonRpcError>} A promise that resolves to the transaction count in hexadecimal format or a JsonRpcError.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.ADDRESS, required: true },
    1: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: true },
  })
  async getTransactionCount(
    address: string,
    blockNumOrTag: string | null,
    requestDetails: RequestDetails,
  ): Promise<string | JsonRpcError> {
    return this.accountService.getTransactionCount(address, blockNumOrTag, requestDetails);
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
    const transactionBuffer = Buffer.from(EthImpl.prune0x(transaction), 'hex');

    const networkGasPriceInWeiBars = Utils.addPercentageBufferToGasPrice(
      await this.common.getFeeWeibars(EthImpl.ethGasPrice, requestDetails),
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

    this.ethExecutionsCounter
      .labels(
        CommonService.ethCall,
        callData?.substring(0, constants.FUNCTION_SELECTOR_CHAR_LENGTH) ?? '',
        call.from || '',
        call.to || '',
      )
      .inc();

    return this.contractService.call(call, blockParam, requestDetails);
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

    return CommonService.formatContractResult({
      ...contractResults[0],
      from: resolvedFromAddress,
      to: resolvedToAddress,
    });
  }

  async resolveEvmAddress(
    address: string,
    requestDetails: RequestDetails,
    searchableTypes = [constants.TYPE_CONTRACT, constants.TYPE_TOKEN, constants.TYPE_ACCOUNT],
  ): Promise<string> {
    if (!address) return address;

    const entity = await this.mirrorNodeClient.resolveEntityType(
      address,
      CommonService.ethGetCode,
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

    return CommonService.formatContractResult({
      ...contractResult,
      from: fromAddress,
      to: toAddress,
    });
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

      const gasPriceForTimestamp = await this.common.getCurrentGasPriceForBlock(
        syntheticLogs[0].blockHash,
        requestDetails,
      );
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

      const contractAddress = this.common.getContractAddressFromReceipt(receiptResponse);
      const receipt: ITransactionReceipt = {
        blockHash: toHash32(receiptResponse.block_hash),
        blockNumber: numberTo0x(receiptResponse.block_number),
        from: await this.resolveEvmAddress(receiptResponse.from, requestDetails),
        to: await this.resolveEvmAddress(receiptResponse.to, requestDetails),
        cumulativeGasUsed: numberTo0x(receiptResponse.block_gas_used),
        gasUsed: nanOrNumberTo0x(receiptResponse.gas_used),
        contractAddress: contractAddress,
        logs: logs,
        logsBloom: receiptResponse.bloom === CommonService.emptyHex ? EthImpl.emptyBloom : receiptResponse.bloom,
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

  async getCurrentGasPriceForBlock(blockHash: string, requestDetails: RequestDetails): Promise<string> {
    const block = await this.getBlockByHash(blockHash, false, requestDetails);
    const timestampDecimal = parseInt(block ? block.timestamp : '0', 16);
    const timestampDecimalString = timestampDecimal > 0 ? timestampDecimal.toString() : '';
    const gasPriceForTimestamp = await this.common.getFeeWeibars(
      EthImpl.ethGetTransactionReceipt,
      requestDetails,
      timestampDecimalString,
    );

    return numberTo0x(gasPriceForTimestamp);
  }

  private static prune0x(input: string): string {
    return input.startsWith(CommonService.emptyHex) ? input.substring(2) : input;
  }

  private createTransactionFromLog(log: Log): Transaction1559 {
    return new Transaction1559({
      accessList: undefined, // we don't support access lists for now
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      chainId: this.chain,
      from: log.address,
      gas: EthImpl.defaultTxGas,
      gasPrice: constants.INVALID_EVM_INSTRUCTION,
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
    return EthImpl.zeroHex;
  }

  static isArrayNonEmpty(input: any): boolean {
    return Array.isArray(input) && input.length > 0;
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

  /**
   * Gets all transaction receipts for a block by block hash or block number.
   *
   * @rpcMethod Exposed as eth_getBlockReceipts RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string } blockHashOrBlockNumber The block hash, block number, or block tag
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<Receipt[]>} Array of transaction receipts for the block
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: true },
  })
  public async getBlockReceipts(blockHashOrBlockNumber: string, requestDetails: RequestDetails): Promise<Receipt[]> {
    return await this.blockService.getBlockReceipts(blockHashOrBlockNumber, requestDetails);
  }
}
