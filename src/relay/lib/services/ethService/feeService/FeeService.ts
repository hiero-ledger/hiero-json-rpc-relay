// SPDX-License-Identifier: Apache-2.0

import _ from 'lodash';
import { Logger } from 'pino';

import { ConfigService } from '../../../../../config-service/services';
import { numberTo0x } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import { obtainBlockGasLimit } from '../../../config/blockGasLimit';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { IFeeHistory, MirrorNodeBlock, RequestDetails } from '../../../types';
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
   * The interface through which we interact with the mirror node.
   *
   * @private
   */
  private readonly mirrorNodeClient: MirrorNodeClient;

  /**
   * The logger used for logging all output from this class.
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * Constructor
   *
   * @param mirrorNodeClient
   * @param common
   * @param logger
   * @param cacheService
   */
  constructor(mirrorNodeClient: MirrorNodeClient, common: ICommonService, logger: Logger) {
    this.mirrorNodeClient = mirrorNodeClient;
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

      if (ConfigService.get('ETH_FEE_HISTORY_FIXED')) {
        let oldestBlock = newestBlockNumber - blockCount + 1;
        if (oldestBlock <= 0) {
          blockCount = 1;
          oldestBlock = 1;
        }
        const gasPriceFee = await this.common.gasPrice(requestDetails);
        feeHistory = FeeService.getRepeatedFeeHistory(blockCount, oldestBlock, rewardPercentiles, gasPriceFee);
      } else {
        feeHistory = await this.getFeeHistory(
          blockCount,
          newestBlockNumber,
          latestBlockNumber,
          rewardPercentiles,
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
   * @param requestDetails
   */
  public async maxPriorityFeePerGas(): Promise<string> {
    return constants.ZERO_HEX;
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
      baseFeePerGas: Array(blockCount).fill(fee),
      gasUsedRatio: Array(blockCount).fill(constants.DEFAULT_GAS_USED_RATIO),
      oldestBlock: numberTo0x(oldestBlockNumber),
    };

    // next fee. Due to high block production rate and low fee change rate we add the next fee
    // since by the time a user utilizes the response there will be a next block likely with the same fee
    feeHistory.baseFeePerGas?.push(fee);

    if (shouldIncludeRewards) {
      feeHistory['reward'] = Array(blockCount).fill(Array(rewardPercentiles.length).fill(constants.ZERO_HEX));
    }

    return feeHistory;
  }

  /**
   * @param blockCount
   * @param newestBlockNumber
   * @param latestBlockNumber
   * @param rewardPercentiles
   * @param requestDetails
   * @private
   */
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
      const { fee, gasUsedRatio } = await this.getFeeHistoryDataFromBlock(blockNumber, requestDetails);

      feeHistory.baseFeePerGas?.push(fee);
      feeHistory.gasUsedRatio?.push(gasUsedRatio);
    }

    // get latest block fee
    // @ts-ignore
    let nextBaseFeePerGas: string = _.last(feeHistory.baseFeePerGas);

    if (latestBlockNumber > newestBlockNumber) {
      // get next block fee if the newest block is not the latest
      nextBaseFeePerGas = (await this.getFeeHistoryDataFromBlock(newestBlockNumber + 1, requestDetails)).fee;
    }

    if (nextBaseFeePerGas) {
      feeHistory.baseFeePerGas?.push(nextBaseFeePerGas);
    }

    if (shouldIncludeRewards) {
      feeHistory['reward'] = Array(blockCount).fill(Array(rewardPercentiles.length).fill(constants.ZERO_HEX));
    }

    return feeHistory;
  }

  /**
   * @param blockNumber
   * @param requestDetails
   * @private
   */
  private async getFeeHistoryDataFromBlock(
    blockNumber: number,
    requestDetails: RequestDetails,
  ): Promise<{ fee: string; gasUsedRatio: number }> {
    let block: MirrorNodeBlock | undefined;
    try {
      block = await this.mirrorNodeClient.getBlock(blockNumber, requestDetails);
      if (!block) {
        this.logger.warn(`Fee history: block ${blockNumber} not found. Returning zero fee and gasUsedRatio.`);
        return { fee: constants.ZERO_HEX, gasUsedRatio: 0 };
      }
    } catch (error) {
      this.logger.warn(
        error,
        `Fee history cannot retrieve block. Returning zero fee and gasUsedRatio for block %s`,
        blockNumber,
      );
      return { fee: constants.ZERO_HEX, gasUsedRatio: 0 };
    }

    const gasUsedRatio = this.getGasUsedRatioForBlock(block);

    try {
      const fee = await this.common.getGasPriceInWeibars(requestDetails, `lte:${block.timestamp.to}`);
      return { fee: numberTo0x(fee), gasUsedRatio };
    } catch (error) {
      this.logger.warn(error, `Fee history cannot retrieve fee. Returning zero fee for block %s`, blockNumber);
      return { fee: constants.ZERO_HEX, gasUsedRatio };
    }
  }

  /**
   * Returns the `gasUsedRatio` entry for for a block
   * `gasUsed / blockGasLimit`, using {@link MirrorNodeBlock.gas_used} as gas used.
   *
   * If `gasUsed` exceeds that limit, logs a warning and returns `1` (100% usage).
   *
   * @param block - Mirror node block metadata (must include `number`, `gas_used`)
   * @returns Ratio in the range [0, 1] suitable for JSON-RPC `gasUsedRatio`
   * @private
   */
  private getGasUsedRatioForBlock(block: MirrorNodeBlock): number {
    const blockGasLimit = obtainBlockGasLimit(block.hapi_version);
    const gasUsed = block.gas_used ?? 0;
    const blockNumber = block.number;

    if (gasUsed > blockGasLimit) {
      this.logger.warn(
        'eth_feeHistory: gasUsed exceeds block gas limit for block %s; Gas used: %s, Block gas limit: %s; clamping gasUsedRatio to 1',
        blockNumber,
        gasUsed,
        blockGasLimit,
      );
      return 1;
    }
    return gasUsed / blockGasLimit;
  }
}
