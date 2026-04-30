// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { ConfigService } from '../../../../../config-service/services';
import { numberTo0x } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import { obtainBlockGasLimit } from '../../../config/blockGasLimit';
import constants from '../../../constants';
import { JsonRpcError, predefined } from '../../../errors/JsonRpcError';
import { IFeeHistory, MirrorNodeBlock, MirrorNodeContractResult, RequestDetails } from '../../../types';
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

      if (ConfigService.get('ETH_FEE_HISTORY_FIXED')) {
        let oldestBlock = newestBlockNumber - blockCount + 1;
        if (oldestBlock <= 0) {
          blockCount = 1;
          oldestBlock = 1;
        }
        const gasPriceFee = await this.common.gasPrice(requestDetails);
        return FeeService.getRepeatedFeeHistory(blockCount, oldestBlock, rewardPercentiles, gasPriceFee);
      }

      return await this.getFeeHistory(
        blockCount,
        newestBlockNumber,
        latestBlockNumber,
        rewardPercentiles,
        requestDetails,
      );
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
    const oldestBlockNumber = Math.max(0, newestBlockNumber - blockCount + 1);
    const shouldIncludeRewards = Array.isArray(rewardPercentiles) && rewardPercentiles.length > 0;
    const blockNumbers = Array.from(
      { length: newestBlockNumber - oldestBlockNumber + 1 },
      (_, i) => oldestBlockNumber + i,
    );

    // The next-block (newestBlockNumber+1) promise starts concurrently with the main block pipelines
    const nextBaseFeePerGasPromise: Promise<string> =
      latestBlockNumber > newestBlockNumber
        ? this.fetchBlockFeeAndBlockGasUsed(newestBlockNumber + 1, requestDetails)
            .then(({ fee }) => fee)
            .catch(() => this.common.getGasPriceInWeibars(requestDetails).then(numberTo0x))
        : this.common.getGasPriceInWeibars(requestDetails).then(numberTo0x);

    // Each block's pipeline runs fully in parallel: block fetch -> CR fetch -> fee computation and gasUsedRatio.
    const [feeData, nextBaseFeePerGas] = await Promise.all([
      Promise.all(
        blockNumbers.map(async (n): Promise<{ fee: string; gasUsedRatio: number }> => {
          return await this.fetchBlockFeeAndBlockGasUsed(n, requestDetails);
        }),
      ),
      nextBaseFeePerGasPromise,
    ]);

    const feeHistory: IFeeHistory = {
      baseFeePerGas: [...feeData.map((d) => d.fee), nextBaseFeePerGas],
      gasUsedRatio: feeData.map((d) => d.gasUsedRatio),
      oldestBlock: numberTo0x(oldestBlockNumber),
    };

    if (shouldIncludeRewards) {
      feeHistory['reward'] = Array(blockCount).fill(Array(rewardPercentiles!.length).fill(constants.ZERO_HEX));
    }

    return feeHistory;
  }

  /**
   * Fetches the block fee and gas used ratio for a given block number.
   * Retrieves the block from the mirror node, obtains contract results if gas was used,
   * and computes the gas-weighted average fee per gas.
   * If the block cannot be fetched, logs a warning and returns an object with zero fee and zero gas used ratio.
   *
   * @param blockNumber - The block number to fetch the fee for.
   * @param requestDetails - Details of the request, used for mirror node interactions.
   * @returns A promise that resolves to an object containing the computed fee as a hex string and the gas used ratio.
   * @private
   */
  private async fetchBlockFeeAndBlockGasUsed(
    blockNumber: number,
    requestDetails: RequestDetails,
  ): Promise<{ fee: string; gasUsedRatio: number }> {
    const block = await this.mirrorNodeClient.getBlock(blockNumber, requestDetails).catch((error) => {
      this.logger.warn(error, `Fee history: failed to fetch block %s`, blockNumber);
      return null;
    });
    if (!block) return { fee: constants.ZERO_HEX, gasUsedRatio: 0 };
    const contractResults: MirrorNodeContractResult[] = block.gas_used
      ? ((await this.mirrorNodeClient
          .getContractResults(requestDetails, {
            timestamp: [`gte:${block.timestamp.from}`, `lte:${block.timestamp.to}`],
          })
          .catch(() => [])) as MirrorNodeContractResult[])
      : [];
    const fee = await this.common
      .computeGasWeightedAvgFeePerGas(contractResults, block, requestDetails)
      .catch((error) => {
        this.logger.warn(error, `Fee history: failed to compute fee for block %s`, blockNumber);
        return constants.ZERO_HEX;
      });
    return {
      fee,
      gasUsedRatio: this.getGasUsedRatioForBlock(block),
    };
  }

  /**
   * Returns the `gasUsedRatio` entry for a block
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
