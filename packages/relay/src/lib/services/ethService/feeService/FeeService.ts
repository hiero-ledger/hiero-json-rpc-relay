// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import _ from 'lodash';
import { Logger } from 'pino';

import { numberTo0x } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { IFeeHistory, RequestDetails } from '../../../types';
import { ICommonService } from '../ethCommonService/ICommonService';
import { IFeeService } from '../feeService/IFeeService';

export class FeeService implements IFeeService {
  /**
   * The Common Service implementation that contains logic shared by other services.
   *
   * @private
   */
  private readonly common: ICommonService;

  /**
   * The logger used for logging all output from this class.
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * Constructor
   *
   * @param common
   * @param logger
   * @param cacheService
   */
  constructor(common: ICommonService, logger: Logger) {
    this.common = common;
    this.logger = logger;
  }

  /**
   * Returns a collection of historical gas information from which you can decide what to submit as your gas.
   *
   * @param blockCount
   * @param newestBlock
   * @param rewardPercentiles
   * @param requestDetails
   */
  public async feeHistory(
    blockCount: number,
    newestBlock: string,
    rewardPercentiles: Array<number> | null,
    requestDetails: RequestDetails,
  ): Promise<IFeeHistory | JsonRpcError> {
    const maxResults = ConfigService.get('TEST')
      ? constants.DEFAULT_FEE_HISTORY_MAX_RESULTS
      : Number(ConfigService.get('FEE_HISTORY_MAX_RESULTS'));
    const maxRewardPercentilesSize = constants.FEE_HISTORY_REWARD_PERCENTILES_MAX_SIZE;
    if (rewardPercentiles && rewardPercentiles.length > maxRewardPercentilesSize) {
      throw predefined.INVALID_PARAMETER(
        2,
        `Reward percentiles size ${rewardPercentiles.length} is greater than the maximum allowed size ${maxRewardPercentilesSize}`,
      );
    }

    try {
      const latestBlockNumber = await this.common.translateBlockTag(constants.BLOCK_LATEST, requestDetails);
      const newestBlockNumber =
        newestBlock == constants.BLOCK_LATEST || newestBlock == constants.BLOCK_PENDING
          ? latestBlockNumber
          : await this.common.translateBlockTag(newestBlock, requestDetails);

      if (newestBlockNumber > latestBlockNumber) {
        return predefined.REQUEST_BEYOND_HEAD_BLOCK(newestBlockNumber, latestBlockNumber);
      }
      blockCount = blockCount > maxResults ? maxResults : blockCount;

      if (blockCount <= 0) {
        const feeHistoryZeroBlockCountResponse: IFeeHistory = {
          gasUsedRatio: null,
          oldestBlock: constants.ZERO_HEX,
          baseFeePerGas: undefined,
        };
        return feeHistoryZeroBlockCountResponse;
      }
      let feeHistory: IFeeHistory;

      const gasPriceFee = await this.common.gasPrice(requestDetails);
      if (ConfigService.get('ETH_FEE_HISTORY_FIXED')) {
        let oldestBlock = newestBlockNumber - blockCount + 1;
        if (oldestBlock <= 0) {
          blockCount = 1;
          oldestBlock = 1;
        }
        feeHistory = FeeService.getRepeatedFeeHistory(blockCount, oldestBlock, rewardPercentiles, gasPriceFee);
      } else {
        feeHistory = await this.getFeeHistory(
          blockCount,
          newestBlockNumber,
          latestBlockNumber,
          rewardPercentiles,
          gasPriceFee,
          requestDetails,
        );
      }

      return feeHistory;
    } catch (e) {
      const feeHistoryEmptyResponse: IFeeHistory = {
        baseFeePerGas: [],
        gasUsedRatio: [],
        reward: [],
        oldestBlock: constants.ZERO_HEX,
      };
      this.logger.error(e, `Error constructing default feeHistory`);
      return feeHistoryEmptyResponse;
    }
  }

  /**
   * Returns a fee per gas that is an estimate of how much you can pay as a priority fee, or tip.
   *
   * Ethereum clients usually use value derived from the 50th percentile effective priority fee
   * of the latest block using `eth_feeHistory` as a fallback for this value. But in our case it would
   * always be the same as the gasPrice, so we can just return ir right away, avoiding expensive operations
   * (we are not burning anything, so all the fees are priority fees and effectively should be the same as the gasPrice).
   *
   * @param requestDetails
   * @return Promise<string> - The priority fee per gas in wei (in our gas price).
   */
  public async maxPriorityFeePerGas(requestDetails: RequestDetails): Promise<string> {
    return await this.common.gasPrice(requestDetails);
  }

  /**
   * @param blockCount
   * @param oldestBlockNumber
   * @param rewardPercentiles
   * @param fee
   * @private
   */
  private static getRepeatedFeeHistory(
    blockCount: number,
    oldestBlockNumber: number,
    rewardPercentiles: Array<number> | null,
    fee: string,
  ): IFeeHistory {
    const shouldIncludeRewards = Array.isArray(rewardPercentiles) && rewardPercentiles.length > 0;

    const feeHistory: IFeeHistory = {
      // This includes the next block after the newest of the returned range, because this value can be derived
      // from the newest block (this is where this plus one comes from). Only zeroes are returned in our case.
      baseFeePerGas: Array(blockCount + 1).fill(constants.ZERO_HEX),
      gasUsedRatio: Array(blockCount).fill(constants.DEFAULT_GAS_USED_RATIO),
      oldestBlock: numberTo0x(oldestBlockNumber),
    };

    if (shouldIncludeRewards) {
      feeHistory['reward'] = Array(blockCount).fill(Array(rewardPercentiles.length).fill(fee));
    }

    return feeHistory;
  }

  /**
   * @param blockCount
   * @param newestBlockNumber
   * @param latestBlockNumber
   * @param rewardPercentiles
   * @param fee
   * @param requestDetails
   * @private
   */
  private async getFeeHistory(
    blockCount: number,
    newestBlockNumber: number,
    latestBlockNumber: number,
    rewardPercentiles: Array<number> | null,
    fee: string,
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
      feeHistory.baseFeePerGas?.push(constants.ZERO_HEX);
      feeHistory.gasUsedRatio?.push(constants.DEFAULT_GAS_USED_RATIO);
    }

    // get latest block fee
    // @ts-ignore
    let nextBaseFeePerGas: string = _.last(feeHistory.baseFeePerGas);

    if (latestBlockNumber > newestBlockNumber) {
      // get next block fee if the newest block is not the latest
      nextBaseFeePerGas = constants.ZERO_HEX;
    }

    if (nextBaseFeePerGas) {
      feeHistory.baseFeePerGas?.push(nextBaseFeePerGas);
    }

    if (shouldIncludeRewards) {
      feeHistory['reward'] = Array(blockCount).fill(Array(rewardPercentiles.length).fill(fee));
    }

    return feeHistory;
  }
}
