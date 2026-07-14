// SPDX-License-Identifier: Apache-2.0

import _ from 'lodash';
import { type Logger } from 'pino';

import { ConfigService } from '../../../../../config-service/services';
import { numberTo0x } from '../../../../formatters';
import { type MirrorNodeClient } from '../../../clients';
import { obtainBlockGasLimit } from '../../../config/blockGasLimit';
import constants from '../../../constants';
import { type JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { type IFeeHistory, type MirrorNodeBlock, type RequestDetails } from '../../../types';
import { type ICommonService } from '../ethCommonService/ICommonService';
import { type IFeeService } from '../feeService/IFeeService';

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
        newestBlock === constants.BLOCK_LATEST || newestBlock === constants.BLOCK_PENDING
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

    const rangeEnd = latestBlockNumber > newestBlockNumber ? newestBlockNumber + 1 : newestBlockNumber;
    const blocksByNumber = await this.getBlocksInRange(oldestBlockNumber, rangeEnd, requestDetails);

    for (let blockNumber = oldestBlockNumber; blockNumber <= newestBlockNumber; blockNumber++) {
      const { fee, gasUsedRatio } = await this.getFeeHistoryDataFromBlock(
        blockNumber,
        requestDetails,
        blocksByNumber.get(blockNumber),
      );

      feeHistory.baseFeePerGas?.push(fee);
      feeHistory.gasUsedRatio?.push(gasUsedRatio);
    }

    // get latest block fee
    // @ts-ignore
    let nextBaseFeePerGas: string = _.last(feeHistory.baseFeePerGas);

    if (latestBlockNumber > newestBlockNumber) {
      nextBaseFeePerGas = (
        await this.getFeeHistoryDataFromBlock(newestBlockNumber + 1, requestDetails, blocksByNumber.get(newestBlockNumber + 1))
      ).fee;
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
   * Retrieves the blocks spanning the inclusive range `[oldestBlockNumber, newestBlockNumber]`,
   * keyed by block number to give the fee assembly loop constant-time access to each block.
   *
   * Block retrieval is treated as best-effort: a failed range query (a transient mirror node
   * error, or a range wider than `FEE_HISTORY_BLOCK_PAGINATION_MAX` allows) resolves to an empty
   * map instead of throwing. Each block is then resolved on demand so the `eth_feeHistory`
   * request still completes instead of failing outright.
   *
   * @param oldestBlockNumber - Inclusive lower bound block number (oldest).
   * @param newestBlockNumber - Inclusive upper bound block number (newest).
   * @param requestDetails - Request metadata used for logging and tracing.
   * @returns Blocks indexed by block number; empty when the range could not be retrieved.
   * @private
   */
  private async getBlocksInRange(
    oldestBlockNumber: number,
    newestBlockNumber: number,
    requestDetails: RequestDetails,
  ): Promise<Map<number, MirrorNodeBlock>> {
    try {
      const blocks = await this.mirrorNodeClient.getBlocksByRange(
        requestDetails,
        oldestBlockNumber,
        newestBlockNumber,
      );
      return new Map(blocks.map((block) => [block.number, block] as [number, MirrorNodeBlock]));
    } catch (error) {
      this.logger.warn(
        error,
        `Fee history: unable to batch-fetch blocks for range %s-%s; resolving blocks individually`,
        oldestBlockNumber,
        newestBlockNumber,
      );
      return new Map();
    }
  }

  /**
   * Resolves the base fee per gas and the gas-used ratio for a single block. Unavailable block
   * data or gas price information degrade to zero values, ensuring one unresolved block does not
   * fail the surrounding fee history response.
   *
   * @param blockNumber - Block whose fee data is requested.
   * @param requestDetails - Request metadata used for logging and tracing.
   * @param prefetchedBlock - Block already obtained from the range query; when omitted, the block
   *   is retrieved on demand.
   * @returns The block's base fee per gas (hex) and its gas-used ratio.
   * @private
   */
  private async getFeeHistoryDataFromBlock(
    blockNumber: number,
    requestDetails: RequestDetails,
    prefetchedBlock?: MirrorNodeBlock,
  ): Promise<{ fee: string; gasUsedRatio: number }> {
    let block: MirrorNodeBlock | undefined = prefetchedBlock;
    if (!block) {
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
