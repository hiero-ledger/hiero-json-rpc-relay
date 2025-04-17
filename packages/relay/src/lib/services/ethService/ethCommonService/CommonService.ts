// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Hbar } from '@hashgraph/sdk';
import * as _ from 'lodash';
import { Logger } from 'pino';

import {
  isHex,
  nanOrNumberInt64To0x,
  nanOrNumberTo0x,
  nullableNumberTo0x,
  numberTo0x,
  parseNumericEnvVar,
  prepend0x,
  stripLeadingZeroForSignatures,
  tinybarsToWeibars,
  toHash32,
  weibarHexToTinyBarInt,
} from '../../../../formatters';
import { Utils } from '../../../../utils';
import { MirrorNodeClient } from '../../../clients';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../errors/MirrorNodeClientError';
import { SDKClientError } from '../../../errors/SDKClientError';
import { EthImpl } from '../../../eth';
import { Log, Transaction } from '../../../model';
import { IAccountInfo, IContractCallRequest, RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
import { TransactionFactory } from '../../factories/transactionFactory';
import HAPIService from '../../hapiService/hapiService';
import { ICommonService } from './ICommonService';

/**
 * Create a new Common Service implementation.
 * @param mirrorNodeClient
 * @param logger
 * @param chain
 * @param registry
 * @param cacheService
 */
export class CommonService implements ICommonService {
  /**
   * The interface through which we interact with the mirror node
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * The client service which is responsible for client all logic related to initialization, reinitialization and error/transactions tracking.
   *
   * @private
   */
  private readonly hapiService: HAPIService;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  /**
   * The LRU cache used for caching items from requests.
   *
   * @private
   */
  private readonly cacheService: CacheService;

  /**
   * public constants
   */
  public static readonly blockEarliest = 'earliest';
  public static readonly blockFinalized = 'finalized';
  public static readonly blockHashLength = 66;
  public static readonly blockLatest = 'latest';
  public static readonly blockPending = 'pending';
  public static readonly blockSafe = 'safe';
  public static readonly defaultTxGas = numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT);
  public static readonly ethCall = 'eth_call';
  public static readonly ethGetBalance = 'eth_getBalance';
  public static readonly ethGetCode = 'eth_getCode';
  public static readonly ethGetTransactionCount = 'eth_getTransactionCount';
  public static readonly emptyHex = '0x';
  public static readonly isDevMode = ConfigService.get('DEV_MODE');
  public static readonly latestBlockNumber = 'getLatestBlockNumber';
  public static readonly oneHex = '0x1';
  public static readonly zeroHex = '0x0';
  public static readonly oneTwoThreeFourHex = '0x1234';
  public static readonly zeroHex32Byte = '0x0000000000000000000000000000000000000000000000000000000000000000';
  public static readonly twoHex = '0x2';
  public static readonly zeroHex8Byte = '0x0000000000000000';
  public static readonly zeroAddressHex = '0x0000000000000000000000000000000000000000';
  public static readonly emptyArrayHex = '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347';

  /**
   * private constants
   * @private
   */
  private readonly ethBlockNumberCacheTtlMs = parseNumericEnvVar(
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS',
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT',
  );
  private readonly ethGasPriceCacheTtlMs = parseNumericEnvVar(
    'ETH_GET_GAS_PRICE_CACHE_TTL_MS',
    'ETH_GET_GAS_PRICE_CACHE_TTL_MS_DEFAULT',
  );
  private readonly maxBlockRange = parseNumericEnvVar('MAX_BLOCK_RANGE', 'MAX_BLOCK_RANGE');
  private readonly maxTimestampParamRange = 604800; // 7 days
  static EMPTY_HEX = '0x';

  /**
   * @private
   */
  private static getLogsBlockRangeLimit() {
    return ConfigService.get('ETH_GET_LOGS_BLOCK_RANGE_LIMIT');
  }

  constructor(
    mirrorNodeClient: MirrorNodeClient,
    logger: Logger,
    cacheService: CacheService,
    hapiService: HAPIService,
  ) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.logger = logger;
    this.cacheService = cacheService;
    this.hapiService = hapiService;
  }

  public static blockTagIsLatestOrPendingStrict(tag: string | null): boolean {
    return tag === CommonService.blockLatest || tag === CommonService.blockPending;
  }

  public blockTagIsLatestOrPending = (tag): boolean => {
    return (
      tag == null ||
      tag === CommonService.blockLatest ||
      tag === CommonService.blockPending ||
      tag === CommonService.blockSafe ||
      tag === CommonService.blockFinalized
    );
  };

  public async validateBlockRangeAndAddTimestampToParams(
    params: any,
    fromBlock: string,
    toBlock: string,
    requestDetails: RequestDetails,
    address?: string | string[] | null,
  ) {
    if (this.blockTagIsLatestOrPending(toBlock)) {
      toBlock = CommonService.blockLatest;
    } else {
      const latestBlockNumber: string = await this.getLatestBlockNumber(requestDetails);

      // - When `fromBlock` is not explicitly provided, it defaults to `latest`.
      // - Then if `toBlock` equals `latestBlockNumber`, it means both `toBlock` and `fromBlock` essentially refer to the latest block, so the `MISSING_FROM_BLOCK_PARAM` error is not necessary.
      // - If `toBlock` is explicitly provided and does not equals to `latestBlockNumber`, it establishes a solid upper bound.
      // - If `fromBlock` is missing, indicating the absence of a lower bound, throw the `MISSING_FROM_BLOCK_PARAM` error.
      if (Number(toBlock) !== Number(latestBlockNumber) && !fromBlock) {
        throw predefined.MISSING_FROM_BLOCK_PARAM;
      }
    }

    if (this.blockTagIsLatestOrPending(fromBlock)) {
      fromBlock = CommonService.blockLatest;
    }

    let fromBlockNum = 0;
    let toBlockNum;
    params.timestamp = [];

    const fromBlockResponse = await this.getHistoricalBlockResponse(requestDetails, fromBlock, true);
    if (!fromBlockResponse) {
      return false;
    }

    params.timestamp.push(`gte:${fromBlockResponse.timestamp.from}`);

    if (fromBlock === toBlock) {
      params.timestamp.push(`lte:${fromBlockResponse.timestamp.to}`);
    } else {
      fromBlockNum = parseInt(fromBlockResponse.number);
      const toBlockResponse = await this.getHistoricalBlockResponse(requestDetails, toBlock, true);

      /**
       * If `toBlock` is not provided, the `lte` field cannot be set,
       * resulting in a request to the Mirror Node that includes only the `gte` parameter.
       * Such requests will be rejected, hence causing the whole request to fail.
       * Return false to handle this gracefully and return an empty response to end client.
       */
      if (!toBlockResponse) {
        return false;
      }

      params.timestamp.push(`lte:${toBlockResponse.timestamp.to}`);
      toBlockNum = parseInt(toBlockResponse.number);

      // Validate timestamp range for Mirror Node requests (maximum: 7 days or 604,800 seconds) to prevent exceeding the limit,
      // as requests with timestamp parameters beyond 7 days are rejected by the Mirror Node.
      const timestampDiff = toBlockResponse.timestamp.to - fromBlockResponse.timestamp.from;
      if (timestampDiff > this.maxTimestampParamRange) {
        throw predefined.TIMESTAMP_RANGE_TOO_LARGE(
          prepend0x(fromBlockNum.toString(16)),
          fromBlockResponse.timestamp.from,
          prepend0x(toBlockNum.toString(16)),
          toBlockResponse.timestamp.to,
        );
      }

      if (fromBlockNum > toBlockNum) {
        throw predefined.INVALID_BLOCK_RANGE;
      }

      const blockRangeLimit = CommonService.getLogsBlockRangeLimit();
      // Increasing it to more then one address may degrade mirror node performance
      // when addresses contains many log events.
      const isSingleAddress = Array.isArray(address)
        ? address.length === 1
        : typeof address === 'string' && address !== '';
      if (!isSingleAddress && toBlockNum - fromBlockNum > blockRangeLimit) {
        throw predefined.RANGE_TOO_LARGE(blockRangeLimit);
      }
    }

    return true;
  }

  public async validateBlockRange(fromBlock: string, toBlock: string, requestDetails: RequestDetails) {
    let fromBlockNumber: any = null;
    let toBlockNumber: any = null;

    if (this.blockTagIsLatestOrPending(toBlock)) {
      toBlock = CommonService.blockLatest;
    } else {
      toBlockNumber = Number(toBlock);

      const latestBlockNumber: string = await this.getLatestBlockNumber(requestDetails);

      // - When `fromBlock` is not explicitly provided, it defaults to `latest`.
      // - Then if `toBlock` equals `latestBlockNumber`, it means both `toBlock` and `fromBlock` essentially refer to the latest block, so the `MISSING_FROM_BLOCK_PARAM` error is not necessary.
      // - If `toBlock` is explicitly provided and does not equals to `latestBlockNumber`, it establishes a solid upper bound.
      // - If `fromBlock` is missing, indicating the absence of a lower bound, throw the `MISSING_FROM_BLOCK_PARAM` error.
      if (Number(toBlock) !== Number(latestBlockNumber) && !fromBlock) {
        throw predefined.MISSING_FROM_BLOCK_PARAM;
      }
    }

    if (this.blockTagIsLatestOrPending(fromBlock)) {
      fromBlock = CommonService.blockLatest;
    } else {
      fromBlockNumber = Number(fromBlock);
    }

    // If either or both fromBlockNumber and toBlockNumber are not set, it means fromBlock and/or toBlock is set to latest, involve MN to retrieve their block number.
    if (!fromBlockNumber || !toBlockNumber) {
      const fromBlockResponse = await this.getHistoricalBlockResponse(requestDetails, fromBlock, true);
      const toBlockResponse = await this.getHistoricalBlockResponse(requestDetails, toBlock, true);

      if (fromBlockResponse) {
        fromBlockNumber = parseInt(fromBlockResponse.number);
      }

      if (toBlockResponse) {
        toBlockNumber = parseInt(toBlockResponse.number);
      }
    }

    if (fromBlockNumber > toBlockNumber) {
      throw predefined.INVALID_BLOCK_RANGE;
    }

    return true;
  }

  /**
   * returns the block response
   * otherwise return undefined.
   *
   * @param requestDetails
   * @param blockNumberOrTagOrHash
   * @param returnLatest
   */
  public async getHistoricalBlockResponse(
    requestDetails: RequestDetails,
    blockNumberOrTagOrHash?: string | null,
    returnLatest: boolean = true,
  ): Promise<any> {
    if (!returnLatest && this.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} Detected a contradiction between blockNumberOrTagOrHash and returnLatest. The request does not target the latest block, yet blockNumberOrTagOrHash representing latest or pending: returnLatest=${returnLatest}, blockNumberOrTagOrHash=${blockNumberOrTagOrHash}`,
        );
      }
      return null;
    }

    if (blockNumberOrTagOrHash === CommonService.emptyHex) {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} Invalid input detected in getHistoricalBlockResponse(): blockNumberOrTagOrHash=${blockNumberOrTagOrHash}.`,
        );
      }
      return null;
    }

    const blockNumber = Number(blockNumberOrTagOrHash);
    if (blockNumberOrTagOrHash != null && blockNumberOrTagOrHash.length < 32 && !isNaN(blockNumber)) {
      const latestBlockResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails);
      const latestBlock = latestBlockResponse.blocks[0];
      if (blockNumber > latestBlock.number + this.maxBlockRange) {
        return null;
      }
    }

    if (blockNumberOrTagOrHash == null || this.blockTagIsLatestOrPending(blockNumberOrTagOrHash)) {
      const latestBlockResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails);
      return latestBlockResponse.blocks[0];
    }

    if (blockNumberOrTagOrHash == CommonService.blockEarliest) {
      return await this.mirrorNodeClient.getBlock(0, requestDetails);
    }

    if (blockNumberOrTagOrHash.length < 32) {
      return await this.mirrorNodeClient.getBlock(Number(blockNumberOrTagOrHash), requestDetails);
    }

    return await this.mirrorNodeClient.getBlock(blockNumberOrTagOrHash, requestDetails);
  }

  /**
   * Gets the most recent block number.
   */
  public async getLatestBlockNumber(requestDetails: RequestDetails): Promise<string> {
    // check for cached value
    const cacheKey = `${constants.CACHE_KEY.ETH_BLOCK_NUMBER}`;
    const blockNumberCached = await this.cacheService.getAsync(
      cacheKey,
      CommonService.latestBlockNumber,
      requestDetails,
    );

    if (blockNumberCached) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} returning cached value ${cacheKey}:${JSON.stringify(
            blockNumberCached,
          )}`,
        );
      }
      return blockNumberCached;
    }

    const blocksResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails);
    const blocks = blocksResponse !== null ? blocksResponse.blocks : null;
    if (Array.isArray(blocks) && blocks.length > 0) {
      const currentBlock = numberTo0x(blocks[0].number);
      // save the latest block number in cache
      await this.cacheService.set(
        cacheKey,
        currentBlock,
        CommonService.latestBlockNumber,
        requestDetails,
        this.ethBlockNumberCacheTtlMs,
      );

      return currentBlock;
    }

    throw predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK;
  }

  public genericErrorHandler(error: any, logMessage?: string) {
    if (logMessage) {
      this.logger.error(error, logMessage);
    } else {
      this.logger.error(error);
    }

    if (error instanceof SDKClientError && error.isGrpcTimeout()) {
      throw predefined.REQUEST_TIMEOUT;
    }

    if (error instanceof JsonRpcError) {
      throw error;
    }
    throw predefined.INTERNAL_ERROR(error.message.toString());
  }

  public async validateBlockHashAndAddTimestampToParams(
    params: any,
    blockHash: string,
    requestDetails: RequestDetails,
  ) {
    try {
      const block = await this.mirrorNodeClient.getBlock(blockHash, requestDetails);
      if (block) {
        params.timestamp = [`gte:${block.timestamp.from}`, `lte:${block.timestamp.to}`];
      } else {
        return false;
      }
    } catch (e: any) {
      if (e instanceof MirrorNodeClientError && e.isNotFound()) {
        return false;
      }

      throw e;
    }

    return true;
  }

  public addTopicsToParams(params: any, topics: any[] | null) {
    if (topics) {
      for (let i = 0; i < topics.length; i++) {
        if (!_.isNil(topics[i])) {
          params[`topic${i}`] = topics[i];
        }
      }
    }
  }

  public async getLogsByAddress(address: string | string[], params: any, requestDetails: RequestDetails) {
    const addresses = Array.isArray(address) ? address : [address];
    const logPromises = addresses.map((addr) =>
      this.mirrorNodeClient.getContractResultsLogsByAddress(addr, requestDetails, params, undefined),
    );

    const logResults = await Promise.all(logPromises);
    const logs = logResults.flatMap((logResult) => (logResult ? logResult : []));
    logs.sort((a: any, b: any) => {
      return a.timestamp >= b.timestamp ? 1 : -1;
    });

    return logs;
  }

  public async getLogsWithParams(
    address: string | string[] | null,
    params: any,
    requestDetails: RequestDetails,
  ): Promise<Log[]> {
    const EMPTY_RESPONSE = [];

    let logResults;
    if (address) {
      logResults = await this.getLogsByAddress(address, params, requestDetails);
    } else {
      logResults = await this.mirrorNodeClient.getContractResultsLogsWithRetry(requestDetails, params);
    }

    if (!logResults) {
      return EMPTY_RESPONSE;
    }

    const logs: Log[] = [];
    for (const log of logResults) {
      logs.push(
        new Log({
          address: log.address,
          blockHash: toHash32(log.block_hash),
          blockNumber: numberTo0x(log.block_number),
          data: log.data,
          logIndex: numberTo0x(log.index),
          removed: false,
          topics: log.topics,
          transactionHash: toHash32(log.transaction_hash),
          transactionIndex: numberTo0x(log.transaction_index),
        }),
      );
    }

    return logs;
  }

  public async getLogs(
    blockHash: string | null,
    fromBlock: string | 'latest',
    toBlock: string | 'latest',
    address: string | string[] | null,
    topics: any[] | null,
    requestDetails: RequestDetails,
  ): Promise<Log[]> {
    const EMPTY_RESPONSE = [];
    const params: any = {};

    if (blockHash) {
      if (!(await this.validateBlockHashAndAddTimestampToParams(params, blockHash, requestDetails))) {
        return EMPTY_RESPONSE;
      }
    } else if (
      !(await this.validateBlockRangeAndAddTimestampToParams(params, fromBlock, toBlock, requestDetails, address))
    ) {
      return EMPTY_RESPONSE;
    }

    this.addTopicsToParams(params, topics);

    return this.getLogsWithParams(address, params, requestDetails);
  }

  public async resolveEvmAddress(
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
   * Returns the current network fee in denominated in weibars.
   *
   * @param callerName
   * @param requestDetails
   * @param timestamp
   */
  public async getFeeWeibars(callerName: string, requestDetails: RequestDetails, timestamp?: string): Promise<number> {
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
   * Retrieves the current network gas price in weibars.
   *
   * @returns {Promise<string>} The current gas price in weibars as a hexadecimal string.
   * @throws Will throw an error if unable to retrieve the gas price.
   * @param requestDetails
   */
  public async gasPrice(requestDetails: RequestDetails): Promise<string> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} eth_gasPrice`);
    }
    try {
      return numberTo0x(
        Utils.addPercentageBufferToGasPrice(
          await this.getFeeWeibars(EthImpl.ethGasPrice, requestDetails)
        )
      );
    } catch (error) {
      throw this.genericErrorHandler(error, `${requestDetails.formattedRequestId} Failed to retrieve gasPrice`);
    }
  }

  /**
   * Translates a block tag into a number. 'latest', 'pending', and null are the most recent block, 'earliest' is 0, numbers become numbers.
   *
   * @param tag null, a number, or 'latest', 'pending', or 'earliest'
   * @param requestDetails
   * @private
   */
  public async translateBlockTag(tag: string | null, requestDetails: RequestDetails): Promise<number> {
    if (this.blockTagIsLatestOrPending(tag)) {
      return Number(await this.getLatestBlockNumber(requestDetails));
    } else if (tag === EthImpl.blockEarliest) {
      return 0;
    } else {
      return Number(tag);
    }
  }

  private isBlockTagEarliest = (tag: string): boolean => {
    return tag === EthImpl.blockEarliest;
  };

  private isBlockTagFinalized = (tag: string): boolean => {
    return (
      tag === EthImpl.blockFinalized ||
      tag === EthImpl.blockLatest ||
      tag === EthImpl.blockPending ||
      tag === EthImpl.blockSafe
    );
  };

  private isBlockNumValid = (num: string) => {
    return /^0[xX]([1-9A-Fa-f]+[0-9A-Fa-f]{0,13}|0)$/.test(num) && Number.MAX_SAFE_INTEGER >= Number(num);
  };

  public isBlockParamValid = (tag: string | null) => {
    return tag == null || this.isBlockTagEarliest(tag) || this.isBlockTagFinalized(tag) || this.isBlockNumValid(tag);
  };

  public isBlockHash = (blockHash: string): boolean => {
    return new RegExp(constants.BLOCK_HASH_REGEX + '{64}$').test(blockHash);
  };

  /**
   * Perform value format precheck before making contract call towards the mirror node
   * @param {IContractCallRequest} transaction the transaction object
   * @param {RequestDetails} requestDetails the request details for logging and tracking
   */
  public async contractCallFormat(transaction: IContractCallRequest, requestDetails: RequestDetails): Promise<void> {
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
   * Tries to get the account with the given address from the cache,
   * if not found, it fetches it from the mirror node.
   *
   * @param {string} address the address of the account
   * @param {RequestDetails} requestDetails the request details for logging and tracking
   * @returns {Promise<IAccountInfo | null>} the account (if such exists for the given address)
   */
  public async getAccount(address: string, requestDetails: RequestDetails): Promise<IAccountInfo | null> {
    const key = `${constants.CACHE_KEY.ACCOUNT}_${address}`;
    let account = await this.cacheService.getAsync(key, EthImpl.ethEstimateGas, requestDetails);
    if (!account) {
      account = await this.mirrorNodeClient.getAccount(address, requestDetails);
      await this.cacheService.set(key, account, EthImpl.ethEstimateGas, requestDetails);
    }
    return account;
  }

  /**
   * This method retrieves the contract address from the receipt response.
   * If the contract creation is via a system contract, it handles the system contract creation.
   * If not, it returns the address from the receipt response.
   *
   * @param {any} receiptResponse - The receipt response object.
   * @returns {string} The contract address.
   */
  public getContractAddressFromReceipt(receiptResponse: any): string {
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

  public async getCurrentGasPriceForBlock(blockHash: string, requestDetails: RequestDetails): Promise<string> {
    const block = await this.mirrorNodeClient.getBlock(blockHash, requestDetails);
    const timestampDecimalString = block ? block.timestamp.from.split('.')[0] : '';
    const gasPriceForTimestamp = await this.getFeeWeibars(
      EthImpl.ethGetTransactionReceipt,
      requestDetails,
      timestampDecimalString,
    );

    return numberTo0x(gasPriceForTimestamp);
  }

  public static formatContractResult(cr: any): Transaction | null {
    if (cr === null) {
      return null;
    }

    const gasPrice =
      cr.gas_price === null || cr.gas_price === '0x'
        ? '0x0'
        : isHex(cr.gas_price)
        ? numberTo0x(BigInt(cr.gas_price) * BigInt(constants.TINYBAR_TO_WEIBAR_COEF))
        : nanOrNumberTo0x(cr.gas_price);

    const commonFields = {
      blockHash: toHash32(cr.block_hash),
      blockNumber: nullableNumberTo0x(cr.block_number),
      from: cr.from.substring(0, 42),
      gas: nanOrNumberTo0x(cr.gas_used),
      gasPrice,
      hash: cr.hash.substring(0, 66),
      input: cr.function_parameters,
      nonce: nanOrNumberTo0x(cr.nonce),
      r: cr.r === null ? '0x0' : stripLeadingZeroForSignatures(cr.r.substring(0, 66)),
      s: cr.s === null ? '0x0' : stripLeadingZeroForSignatures(cr.s.substring(0, 66)),
      to: cr.to?.substring(0, 42),
      transactionIndex: nullableNumberTo0x(cr.transaction_index),
      type: cr.type === null ? '0x0' : nanOrNumberTo0x(cr.type),
      v: cr.v === null ? '0x0' : nanOrNumberTo0x(cr.v),
      value: nanOrNumberInt64To0x(tinybarsToWeibars(cr.amount, true)),
      // for legacy EIP155 with tx.chainId=0x0, mirror-node will return a '0x' (EMPTY_HEX) value for contract result's chain_id
      //   which is incompatibile with certain tools (i.e. foundry). By setting this field, chainId, to undefined, the end jsonrpc
      //   object will leave out this field, which is the proper behavior for other tools to be compatible with.
      chainId: cr.chain_id === this.EMPTY_HEX ? undefined : cr.chain_id,
    };

    return TransactionFactory.createTransactionByType(cr.type, {
      ...commonFields,
      maxPriorityFeePerGas: cr.max_priority_fee_per_gas,
      maxFeePerGas: cr.max_fee_per_gas,
    });
  }
}
