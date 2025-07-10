// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import { generateRandomHex } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { Log } from '../../../model';
import { RequestDetails } from '../../../types';
import { INewFilterParams } from '../../../types/requestParams';
import { CacheService } from '../../cacheService/cacheService';
import { ICommonService } from '../../index';
import { IFilterService } from './IFilterService';

/**
 * Create a new Filter Service implementation.
 * @param mirrorNodeClient
 * @param logger
 * @param chain
 * @param registry
 * @param cacheService
 */
export class FilterService implements IFilterService {
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

  /**
   * The Common Service implementation that contains logic shared by other services.
   */
  private readonly common: ICommonService;

  public readonly ethNewFilter = 'eth_newFilter';
  public readonly ethUninstallFilter = 'eth_uninstallFilter';
  public readonly ethGetFilterLogs = 'eth_getFilterLogs';
  public readonly ethGetFilterChanges = 'eth_getFilterChanges';
  private readonly supportedTypes: string[];

  constructor(mirrorNodeClient: MirrorNodeClient, logger: Logger, cacheService: CacheService, common: ICommonService) {
    this.mirrorNodeClient = mirrorNodeClient;
    this.logger = logger;
    this.cacheService = cacheService;
    this.common = common;

    this.supportedTypes = [constants.FILTER.TYPE.LOG, constants.FILTER.TYPE.NEW_BLOCK];
  }

  /**
   * Generates cache key for filter ID
   * @param filterId
   * @private
   */
  private getCacheKey(filterId: string): string {
    return `${constants.CACHE_KEY.FILTERID}_${filterId}`;
  }

  /**
   * Updates filter cache with new data
   * @param filterId
   * @param type
   * @param params
   * @param lastQueried
   * @param method
   * @param requestDetails
   * @private
   */
  private async updateFilterCache(
    filterId: string,
    type: string,
    params: any,
    lastQueried: number | null,
    method: string,
    requestDetails: RequestDetails,
  ): Promise<void> {
    const cacheKey = this.getCacheKey(filterId);
    await this.cacheService.set(cacheKey, { type, params, lastQueried }, method, requestDetails, constants.FILTER.TTL);
  }

  /**
   * Retrieves filter from cache
   * @param filterId
   * @param method
   * @param requestDetails
   * @private
   */
  private async getFilterFromCache(filterId: string, method: string, requestDetails: RequestDetails) {
    const cacheKey = this.getCacheKey(filterId);
    return await this.cacheService.getAsync(cacheKey, method, requestDetails);
  }

  /**
   * Creates a new filter with the specified type and parameters
   * @param type
   * @param params
   * @param requestDetails
   */
  async createFilter(type: string, params: any, requestDetails: RequestDetails): Promise<string> {
    const filterId = generateRandomHex();
    await this.updateFilterCache(filterId, type, params, null, this.ethNewFilter, requestDetails);

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} created filter with TYPE=${type}, params: ${JSON.stringify(params)}`,
      );
    }
    return filterId;
  }

  /**
   * Checks if the Filter API is enabled
   */
  static requireFiltersEnabled(): void {
    if (!ConfigService.get('FILTER_API_ENABLED')) {
      throw predefined.UNSUPPORTED_METHOD;
    }
  }

  /**
   * Creates a new filter with TYPE=log
   * @param params
   * @param requestDetails
   */
  async newFilter(params: INewFilterParams, requestDetails: RequestDetails): Promise<string> {
    try {
      FilterService.requireFiltersEnabled();

      const fromBlock = params?.fromBlock === undefined ? constants.BLOCK_LATEST : params?.fromBlock;
      const toBlock = params?.toBlock === undefined ? constants.BLOCK_LATEST : params?.toBlock;

      if (!(await this.common.validateBlockRange(fromBlock, toBlock, requestDetails))) {
        throw predefined.INVALID_BLOCK_RANGE;
      }

      return await this.createFilter(
        constants.FILTER.TYPE.LOG,
        {
          fromBlock:
            fromBlock === constants.BLOCK_LATEST ? await this.common.getLatestBlockNumber(requestDetails) : fromBlock,
          toBlock,
          address: params?.address,
          topics: params?.topics,
        },
        requestDetails,
      );
    } catch (e) {
      throw this.common.genericErrorHandler(e);
    }
  }

  async newBlockFilter(requestDetails: RequestDetails): Promise<string> {
    FilterService.requireFiltersEnabled();

    return await this.createFilter(
      constants.FILTER.TYPE.NEW_BLOCK,
      {
        blockAtCreation: await this.common.getLatestBlockNumber(requestDetails),
      },
      requestDetails,
    );
  }

  public async uninstallFilter(filterId: string, requestDetails: RequestDetails): Promise<boolean> {
    FilterService.requireFiltersEnabled();

    const filter = await this.getFilterFromCache(filterId, this.ethUninstallFilter, requestDetails);

    if (filter) {
      const cacheKey = this.getCacheKey(filterId);
      await this.cacheService.delete(cacheKey, this.ethUninstallFilter, requestDetails);
      return true;
    }

    return false;
  }

  public newPendingTransactionFilter(): JsonRpcError {
    return predefined.UNSUPPORTED_METHOD;
  }

  public async getFilterLogs(filterId: string, requestDetails: RequestDetails): Promise<Log[]> {
    FilterService.requireFiltersEnabled();

    const filter = await this.getFilterFromCache(filterId, this.ethGetFilterLogs, requestDetails);
    if (filter?.type !== constants.FILTER.TYPE.LOG) {
      throw predefined.FILTER_NOT_FOUND;
    }

    const logs = await this.common.getLogs(
      null,
      filter?.params.fromBlock,
      filter?.params.toBlock,
      filter?.params.address,
      filter?.params.topics,
      requestDetails,
    );

    // update filter to refresh TTL
    await this.updateFilterCache(
      filterId,
      filter.type,
      filter.params,
      filter.lastQueried,
      this.ethGetFilterChanges,
      requestDetails,
    );

    return logs;
  }

  /**
   * Handles log filter changes
   * @param filter
   * @param requestDetails
   * @private
   */
  private async handleLogFilterChanges(
    filter: any,
    requestDetails: RequestDetails,
  ): Promise<{ result: Log[]; latestBlockNumber: number }> {
    const result = await this.common.getLogs(
      null,
      filter?.lastQueried || filter?.params.fromBlock,
      filter?.params.toBlock,
      filter?.params.address,
      filter?.params.topics,
      requestDetails,
    );

    // get the latest block number and add 1 to exclude current results from the next response because
    // the mirror node query executes "gte" not "gt"
    const latestBlockNumber =
      Number(
        result.length ? result[result.length - 1].blockNumber : await this.common.getLatestBlockNumber(requestDetails),
      ) + 1;

    return { result, latestBlockNumber };
  }

  /**
   * Handles new block filter changes
   * @param filter
   * @param requestDetails
   * @private
   */
  private async handleNewBlockFilterChanges(
    filter: any,
    requestDetails: RequestDetails,
  ): Promise<{ result: string[]; latestBlockNumber: number }> {
    const blockResponse = await this.mirrorNodeClient.getBlocks(
      requestDetails,
      [`gt:${filter.lastQueried || filter.params.blockAtCreation}`],
      undefined,
      {
        order: 'asc',
      },
    );

    const latestBlockNumber = Number(
      blockResponse?.blocks?.length
        ? blockResponse.blocks[blockResponse.blocks.length - 1].number
        : await this.common.getLatestBlockNumber(requestDetails),
    );

    const result = blockResponse?.blocks?.map((r) => r.hash) || [];

    return { result, latestBlockNumber };
  }

  public async getFilterChanges(filterId: string, requestDetails: RequestDetails): Promise<string[] | Log[]> {
    FilterService.requireFiltersEnabled();

    const filter = await this.getFilterFromCache(filterId, this.ethGetFilterChanges, requestDetails);

    if (!filter) {
      throw predefined.FILTER_NOT_FOUND;
    }

    let result: string[] | Log[];
    let latestBlockNumber: number;

    switch (filter.type) {
      case constants.FILTER.TYPE.LOG: {
        const logResult = await this.handleLogFilterChanges(filter, requestDetails);
        result = logResult.result;
        latestBlockNumber = logResult.latestBlockNumber;
        break;
      }
      case constants.FILTER.TYPE.NEW_BLOCK: {
        const blockResult = await this.handleNewBlockFilterChanges(filter, requestDetails);
        result = blockResult.result;
        latestBlockNumber = blockResult.latestBlockNumber;
        break;
      }
      default:
        throw predefined.UNSUPPORTED_METHOD;
    }

    // update filter to refresh TTL and set lastQueried block number
    await this.updateFilterCache(
      filterId,
      filter.type,
      filter.params,
      latestBlockNumber,
      this.ethGetFilterChanges,
      requestDetails,
    );

    return result;
  }
}
