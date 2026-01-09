// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import * as _ from 'lodash';
import { Logger } from 'pino';

import { numberTo0x, parseNumericEnvVar, prepend0x, toHash32, trimPrecedingZeros } from '../../../../formatters';
import { Utils } from '../../../../utils';
import { MirrorNodeClient } from '../../../clients';
import type { ICacheClient } from '../../../clients/cache/ICacheClient';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../errors/MirrorNodeClientError';
import { SDKClientError } from '../../../errors/SDKClientError';
import { Log } from '../../../model';
import { IAccountInfo, RequestDetails } from '../../../types';
import { WorkersPool } from '../../workersService/WorkersPool';
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
   * The LRU cache used for caching items from requests.
   *
   * @private
   */
  private readonly cacheService: ICacheClient;

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
   * public constants
   */
  public static readonly latestBlockNumber = 'getLatestBlockNumber';

  private readonly maxBlockRange = parseNumericEnvVar('MAX_BLOCK_RANGE', 'MAX_BLOCK_RANGE');
  private readonly maxTimestampParamRange = 604800; // 7 days

  /**
   * @private
   */
  private static getLogsBlockRangeLimit() {
    return ConfigService.get('ETH_GET_LOGS_BLOCK_RANGE_LIMIT');
  }

  constructor(mirrorNodeClient: MirrorNodeClient, logger: Logger, cacheService: ICacheClient) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.logger = logger;
    this.cacheService = cacheService;
  }

  public static blockTagIsLatestOrPendingStrict(tag: string | null): boolean {
    return tag === constants.BLOCK_LATEST || tag === constants.BLOCK_PENDING;
  }

  public blockTagIsLatestOrPending = (tag): boolean => {
    return (
      tag == null ||
      tag === constants.BLOCK_LATEST ||
      tag === constants.BLOCK_PENDING ||
      tag === constants.BLOCK_SAFE ||
      tag === constants.BLOCK_FINALIZED
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
      toBlock = constants.BLOCK_LATEST;
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
      fromBlock = constants.BLOCK_LATEST;
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
      toBlock = constants.BLOCK_LATEST;
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
      fromBlock = constants.BLOCK_LATEST;
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
      this.logger.debug(
        `Detected a contradiction between blockNumberOrTagOrHash and returnLatest. The request does not target the latest block, yet blockNumberOrTagOrHash representing latest or pending: returnLatest=%s, blockNumberOrTagOrHash=%s`,
        returnLatest,
        blockNumberOrTagOrHash,
      );
      return null;
    }

    if (blockNumberOrTagOrHash === constants.EMPTY_HEX) {
      this.logger.debug(
        `Invalid input detected in getHistoricalBlockResponse(): blockNumberOrTagOrHash=%s.`,
        blockNumberOrTagOrHash,
      );
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

    if (blockNumberOrTagOrHash == constants.BLOCK_EARLIEST) {
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
    const blocksResponse = await this.mirrorNodeClient.getLatestBlock(requestDetails);
    const blocks = blocksResponse !== null ? blocksResponse.blocks : null;
    if (Array.isArray(blocks) && blocks.length > 0) {
      return numberTo0x(blocks[0].number);
    }

    throw predefined.COULD_NOT_RETRIEVE_LATEST_BLOCK;
  }

  public genericErrorHandler(error: any, logMessage?: string) {
    if (logMessage) {
      this.logger.error(error, logMessage);
    } else {
      this.logger.error(error);
    }

    // preserve the original error and throw to the upper layer
    if (error instanceof JsonRpcError || error instanceof SDKClientError || error instanceof MirrorNodeClientError) {
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

  /**
   * @param params
   * @param topics
   */
  public addTopicsToParams(params: any, topics: any[] | null) {
    if (topics) {
      for (let i = 0; i < topics.length; i++) {
        if (!_.isNil(topics[i])) {
          if (Array.isArray(topics[i])) {
            if (topics[i].length > 100) {
              throw predefined.INVALID_PARAMETER(i, `Topic ${i} exceeds maximum nested length of 100`);
            }
            const trimmedTopics = topics[i].map((t: string, j: number) => {
              const trimmed = trimPrecedingZeros(t);
              if (trimmed === null) {
                throw predefined.INVALID_PARAMETER(i, `Topic ${i}[${j}] is not a valid hex string`);
              }
              return trimmed;
            });
            params[`topic${i}`] = trimmedTopics;
          } else {
            const trimmed = trimPrecedingZeros(topics[i]);
            if (trimmed === null) {
              throw predefined.INVALID_PARAMETER(i, `Topic ${i} is not a valid hex string`);
            }
            params[`topic${i}`] = trimmed;
          }
        }
      }
    }
  }

  public async getLogsByAddress(
    address: string | string[],
    params: any,
    requestDetails: RequestDetails,
    maxResponseSize: number = 0,
  ) {
    const addresses = Array.isArray(address) ? address : [address];
    const logPromises = addresses.map((addr) =>
      this.mirrorNodeClient.getContractResultsLogsByAddress(addr, requestDetails, params, undefined, maxResponseSize),
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
    maxResponseSize: number = 0,
  ): Promise<Log[]> {
    const EMPTY_RESPONSE = [];

    let logResults;
    if (address) {
      logResults = await this.getLogsByAddress(address, params, requestDetails, maxResponseSize);
    } else {
      logResults = await this.mirrorNodeClient.getContractResultsLogsWithRetry(
        requestDetails,
        params,
        undefined,
        maxResponseSize,
      );
    }

    if (!logResults) {
      return EMPTY_RESPONSE;
    }

    const logs: Log[] = [];
    for (const log of logResults) {
      logs.push(
        new Log({
          address: log.address,
          blockTimestamp: numberTo0x(Number(log.timestamp.split('.')[0])),
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
    return WorkersPool.run(
      {
        type: 'getLogs',
        blockHash,
        fromBlock,
        toBlock,
        address,
        topics,
        requestDetails,
      },
      this.mirrorNodeClient,
      this.cacheService,
    );
  }

  public async resolveEvmAddress(
    address: string,
    requestDetails: RequestDetails,
    searchableTypes = [constants.TYPE_CONTRACT, constants.TYPE_TOKEN, constants.TYPE_ACCOUNT],
  ): Promise<string> {
    if (!address) return address;

    const entity = await this.mirrorNodeClient.resolveEntityType(
      address,
      constants.ETH_GET_CODE,
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
   * Retrieves the current network gas price in weibars from the mirror node.
   *
   * This method fetches network fees from the mirror node for a specific timestamp (if provided)
   * and converts the gas price from tinybars to weibars for Ethereum compatibility.
   *
   * @param {RequestDetails} requestDetails - The details of the request for logging and tracking
   * @param {string} [timestamp] - Optional timestamp to get historical gas prices
   * @returns {Promise<number>} The gas price in weibars
   * @throws {Error} If the gas price cannot be estimated
   */
  public async getGasPriceInWeibars(requestDetails: RequestDetails, timestamp?: string): Promise<number> {
    const networkFees = await this.mirrorNodeClient.getNetworkFees(requestDetails, timestamp, undefined);

    if (networkFees && Array.isArray(networkFees.fees)) {
      const ethereumTransactionTypeFee = networkFees.fees.find(
        ({ transaction_type }) => transaction_type === 'EthereumTransaction',
      );

      if (ethereumTransactionTypeFee?.gas) {
        // convert tinyBars into weiBars and return the value
        return ethereumTransactionTypeFee.gas * constants.TINYBAR_TO_WEIBAR_COEF;
      }
    }

    throw predefined.INTERNAL_ERROR('Failed to retrieve gas price from network fees');
  }

  /**
   * Retrieves the current network gas price in weibars.
   *
   * @returns {Promise<string>} The current gas price in weibars as a hexadecimal string.
   * @throws Will throw an error if unable to retrieve the gas price.
   * @param requestDetails
   */
  public async gasPrice(requestDetails: RequestDetails): Promise<string> {
    try {
      const gasPrice = Utils.addPercentageBufferToGasPrice(await this.getGasPriceInWeibars(requestDetails));

      return numberTo0x(gasPrice);
    } catch (error) {
      throw this.genericErrorHandler(error, `Failed to retrieve gasPrice`);
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
    } else if (tag === constants.BLOCK_EARLIEST) {
      return 0;
    } else {
      return Number(tag);
    }
  }

  private isBlockTagEarliest = (tag: string): boolean => {
    return tag === constants.BLOCK_EARLIEST;
  };

  private isBlockTagFinalized = (tag: string): boolean => {
    return (
      tag === constants.BLOCK_FINALIZED ||
      tag === constants.BLOCK_LATEST ||
      tag === constants.BLOCK_PENDING ||
      tag === constants.BLOCK_SAFE
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
   * Tries to get the account with the given address from the cache,
   * if not found, it fetches it from the mirror node.
   *
   * @param {string} address the address of the account
   * @param {RequestDetails} requestDetails the request details for logging and tracking
   * @returns {Promise<IAccountInfo | null>} the account (if such exists for the given address)
   */
  public async getAccount(address: string, requestDetails: RequestDetails): Promise<IAccountInfo | null> {
    const key = `${constants.CACHE_KEY.ACCOUNT}_${address}`;
    let account = await this.cacheService.getAsync(key, constants.ETH_ESTIMATE_GAS);
    if (!account) {
      account = await this.mirrorNodeClient.getAccount(address, requestDetails);
      await this.cacheService.set(key, account, constants.ETH_ESTIMATE_GAS);
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
    const gasPriceForTimestamp = await this.getGasPriceInWeibars(requestDetails, timestampDecimalString);

    return numberTo0x(gasPriceForTimestamp);
  }

  public static redirectBytecodeAddressReplace(address: string): string {
    const redirectBytecodePrefix = '6080604052348015600f57600080fd5b506000610167905077618dc65e';
    const redirectBytecodePostfix =
      '600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033';
    return `0x${redirectBytecodePrefix}${address.slice(2)}${redirectBytecodePostfix}`;
  }

  /**
   * Determines whether a given transaction qualifies as a subsidized transaction. The method checks if the paymaster
   * FF is enabled and whether the provided `toAddress` is included in the paymaster whitelist. A wildcard `'*'`in
   * the whitelist indicates all addresses are eligible.
   *
   * @param toAddress string | null
   * @returns boolean
   */
  public static isSubsidizedTransaction(toAddress: string | null): boolean {
    const payMasterWhiteList = ConfigService.get('PAYMASTER_WHITELIST').map((e) => e.toLowerCase());

    return !!(
      ConfigService.get('PAYMASTER_ENABLED') &&
      (payMasterWhiteList.includes('*') ||
        (toAddress && payMasterWhiteList.includes(prepend0x(toAddress.toLowerCase()))))
    );
  }
}
