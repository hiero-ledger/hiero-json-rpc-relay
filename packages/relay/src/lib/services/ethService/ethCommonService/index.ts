// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import * as _ from 'lodash';
import { Logger } from 'pino';

import { numberTo0x, parseNumericEnvVar, prepend0x, toHash32 } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../errors/MirrorNodeClientError';
import { SDKClientError } from '../../../errors/SDKClientError';
import { EthImpl } from '../../../eth';
import { Log } from '../../../model';
import { RequestDetails } from '../../../types';
import { CacheService } from '../../cacheService/cacheService';
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

  public static readonly blockLatest = 'latest';
  public static readonly blockEarliest = 'earliest';
  public static readonly blockPending = 'pending';
  public static readonly blockSafe = 'safe';
  public static readonly blockFinalized = 'finalized';
  public static readonly isDevMode = ConfigService.get('DEV_MODE');

  // function callerNames
  public static readonly latestBlockNumber = 'getLatestBlockNumber';

  private readonly maxBlockRange = parseNumericEnvVar('MAX_BLOCK_RANGE', 'MAX_BLOCK_RANGE');
  private readonly ethBlockNumberCacheTtlMs = parseNumericEnvVar(
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS',
    'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT',
  );

  // Maximum allowed timestamp range for mirror node requests' timestamp parameter is 7 days (604800 seconds)
  private readonly maxTimestampParamRange = 604800; // 7 days

  private getLogsBlockRangeLimit() {
    return ConfigService.get('ETH_GET_LOGS_BLOCK_RANGE_LIMIT');
  }

  constructor(mirrorNodeClient: MirrorNodeClient, logger: Logger, cacheService: CacheService) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.logger = logger;
    this.cacheService = cacheService;
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

      const blockRangeLimit = this.getLogsBlockRangeLimit();
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

    if (blockNumberOrTagOrHash === EthImpl.emptyHex) {
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
}
