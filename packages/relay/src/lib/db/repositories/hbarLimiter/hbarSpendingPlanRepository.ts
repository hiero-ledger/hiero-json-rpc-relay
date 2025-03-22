// SPDX-License-Identifier: Apache-2.0

import { randomBytes, uuidV4 } from 'ethers';
import { Logger } from 'pino';

import { CacheService } from '../../../services/cacheService/cacheService';
import { RequestDetails } from '../../../types';
import { HbarSpendingPlan } from '../../entities/hbarLimiter/hbarSpendingPlan';
import { HbarSpendingRecord } from '../../entities/hbarLimiter/hbarSpendingRecord';
import { HbarSpendingPlanNotActiveError, HbarSpendingPlanNotFoundError } from '../../types/hbarLimiter/errors';
import { IDetailedHbarSpendingPlan, IHbarSpendingPlan } from '../../types/hbarLimiter/hbarSpendingPlan';
import { IHbarSpendingRecord } from '../../types/hbarLimiter/hbarSpendingRecord';
import { SubscriptionTier } from '../../types/hbarLimiter/subscriptionTier';

export class HbarSpendingPlanRepository {
  public static readonly collectionKey = 'hbarSpendingPlan';

  /**
   * The cache service used for storing data.
   * @private
   */
  private readonly cache: CacheService;

  /**
   * The logger used for logging all output from this class.
   * @private
   */
  private readonly logger: Logger;

  constructor(cache: CacheService, logger: Logger) {
    this.cache = cache;
    this.logger = logger;
  }

  /**
   * Gets an HBar spending plan by ID.
   * @param {string} id - The ID of the plan to get.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IHbarSpendingPlan>} - The HBar spending plan object.
   */
  async findById(id: string, requestDetails: RequestDetails): Promise<IHbarSpendingPlan> {
    const key = this.getKey(id);
    const plan = await this.cache.getAsync<IHbarSpendingPlan>(key, 'findById', requestDetails);
    if (!plan) {
      throw new HbarSpendingPlanNotFoundError(id);
    }
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(`${requestDetails.formattedRequestId} Retrieved subscription with ID ${id}`);
    }
    return {
      ...plan,
      createdAt: new Date(plan.createdAt),
    };
  }

  /**
   * Gets an HBar spending plan by ID with detailed information (spendingHistory and amountSpent).
   * @param {string} id - The ID of the plan.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IDetailedHbarSpendingPlan>} - The detailed HBar spending plan object.
   */
  async findByIdWithDetails(id: string, requestDetails: RequestDetails): Promise<IDetailedHbarSpendingPlan> {
    const plan = await this.findById(id, requestDetails);
    return new HbarSpendingPlan({
      ...plan,
      spendingHistory: [],
      amountSpent: await this.getAmountSpent(id, requestDetails),
    });
  }

  /**
   * Creates a new HBar spending plan.
   * @param {SubscriptionTier} subscriptionTier - The subscription tier of the plan to create.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {number} ttl - The time-to-live for the plan in milliseconds.
   * @param {string} planId - The ID to assign to the plan. (default: generated UUID)
   * @returns {Promise<IDetailedHbarSpendingPlan>} - The created HBar spending plan object.
   */
  async create(
    subscriptionTier: SubscriptionTier,
    requestDetails: RequestDetails,
    ttl: number,
    planId?: string,
  ): Promise<IDetailedHbarSpendingPlan> {
    const plan: IDetailedHbarSpendingPlan = {
      id: planId ?? uuidV4(randomBytes(16)),
      subscriptionTier: subscriptionTier,
      createdAt: new Date(),
      active: true,
      spendingHistory: [],
      amountSpent: 0,
    };
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(`${requestDetails.formattedRequestId} Creating HbarSpendingPlan with ID ${plan.id}...`);
    }
    const key = this.getKey(plan.id);
    await this.cache.set(key, plan, 'create', requestDetails, ttl);
    return new HbarSpendingPlan(plan);
  }

  async delete(id: string, requestDetails: RequestDetails): Promise<void> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} Deleting HbarSpendingPlan with ID ${id}...`);
    }
    const key = this.getKey(id);
    await this.cache.delete(key, 'delete', requestDetails);
  }

  /**
   * Verify that an HBar spending plan exists and is active.
   * @param {string} id - The ID of the plan.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<void>} - A promise that resolves if the plan exists and is active, or rejects if not.
   */
  async checkExistsAndActive(id: string, requestDetails: RequestDetails): Promise<void> {
    const plan = await this.findById(id, requestDetails);
    if (!plan.active) {
      throw new HbarSpendingPlanNotActiveError(id);
    }
  }

  /**
   * Gets the spending history for an HBar spending plan.
   * @param {string} id - The ID of the plan.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IHbarSpendingRecord[]>} - A promise that resolves with the spending history.
   */
  async getSpendingHistory(id: string, requestDetails: RequestDetails): Promise<IHbarSpendingRecord[]> {
    await this.checkExistsAndActive(id, requestDetails);

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Retrieving spending history for HbarSpendingPlan with ID ${id}...`,
      );
    }
    const key = this.getSpendingHistoryKey(id);
    const spendingHistory = await this.cache.lRange<IHbarSpendingRecord>(
      key,
      0,
      -1,
      'getSpendingHistory',
      requestDetails,
    );
    return spendingHistory.map((entry) => new HbarSpendingRecord(entry));
  }

  /**
   * Adds spending to a plan's spending history.
   * @param {string} id - The ID of the plan.
   * @param {number} amount - The amount to add to the plan's spending.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<number>} - A promise that resolves with the new length of the spending history.
   */
  async addAmountToSpendingHistory(id: string, amount: number, requestDetails: RequestDetails): Promise<number> {
    await this.checkExistsAndActive(id, requestDetails);

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Adding ${amount} to spending history for HbarSpendingPlan with ID ${id}...`,
      );
    }
    const key = this.getSpendingHistoryKey(id);
    const entry: IHbarSpendingRecord = { amount, timestamp: new Date() };
    return this.cache.rPush(key, entry, 'addAmountToSpendingHistory', requestDetails);
  }

  /**
   * Gets the amount spent for an HBar spending plan.
   * @param id - The ID of the plan.
   @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<number>} - A promise that resolves with the amount spent.
   */
  async getAmountSpent(id: string, requestDetails: RequestDetails): Promise<number> {
    await this.checkExistsAndActive(id, requestDetails);

    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${requestDetails.formattedRequestId} Retrieving amountSpent for HbarSpendingPlan with ID ${id}...`,
      );
    }
    const key = this.getAmountSpentKey(id);
    return this.cache
      .getAsync(key, 'getAmountSpent', requestDetails)
      .then((amountSpent) => parseInt(amountSpent ?? '0'));
  }

  /**
   * Resets the amount spent for all hbar spending plans.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   */
  async resetAmountSpentOfAllPlans(requestDetails: RequestDetails): Promise<void> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Resetting the \`amountSpent\` entries for all HbarSpendingPlans...`,
      );
    }
    const callerMethod = this.resetAmountSpentOfAllPlans.name;
    const keys = await this.cache.keys(this.getAmountSpentKey('*'), callerMethod, requestDetails);
    await Promise.all(keys.map((key) => this.cache.delete(key, callerMethod, requestDetails)));
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Successfully reset ${keys.length} "amountSpent" entries for HbarSpendingPlans.`,
      );
    }
  }

  /**
   * Adds an amount to the amount spent for a plan.
   * @param {string} id - The ID of the plan.
   * @param {number} amount - The amount to add.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {number} ttl - The time-to-live for the amountSpent entry in milliseconds.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   */
  async addToAmountSpent(id: string, amount: number, requestDetails: RequestDetails, ttl: number): Promise<void> {
    await this.checkExistsAndActive(id, requestDetails);

    const key = this.getAmountSpentKey(id);
    if (!(await this.cache.getAsync(key, 'addToAmountSpent', requestDetails))) {
      if (this.logger.isLevelEnabled('trace')) {
        this.logger.trace(
          `${requestDetails.formattedRequestId} No spending yet for HbarSpendingPlan with ID ${id}, setting amountSpent to ${amount}...`,
        );
      }
      await this.cache.set(key, amount, 'addToAmountSpent', requestDetails, ttl);
    } else {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${requestDetails.formattedRequestId} Adding ${amount} to amountSpent for HbarSpendingPlan with ID ${id}...`,
        );
      }
      await this.cache.incrBy(key, amount, 'addToAmountSpent', requestDetails);
    }
  }

  /**
   * Finds all active HBar spending plans by subscription tier.
   * @param {SubscriptionTier[]} tiers - The subscription tiers to filter by.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IDetailedHbarSpendingPlan[]>} - A promise that resolves with the active spending plans.
   */
  async findAllActiveBySubscriptionTier(
    tiers: SubscriptionTier[],
    requestDetails: RequestDetails,
  ): Promise<IDetailedHbarSpendingPlan[]> {
    const callerMethod = this.findAllActiveBySubscriptionTier.name;
    const keys = await this.cache.keys(this.getKey('*'), callerMethod, requestDetails);
    const plans = await Promise.all(
      keys.map((key) => this.cache.getAsync<IHbarSpendingPlan>(key, callerMethod, requestDetails)),
    );
    return Promise.all(
      plans
        .filter((plan) => tiers.includes(plan.subscriptionTier) && plan.active)
        .map(
          async (plan) =>
            new HbarSpendingPlan({
              ...plan,
              createdAt: new Date(plan.createdAt),
              spendingHistory: [],
              amountSpent: await this.getAmountSpent(plan.id, requestDetails),
            }),
        ),
    );
  }

  /**
   * Gets the cache key for an {@link IHbarSpendingPlan}.
   * @param id - The ID of the plan to get the key for.
   * @private
   */
  private getKey(id: string): string {
    return `${HbarSpendingPlanRepository.collectionKey}:${id}`;
  }

  /**
   * Gets the cache key for the amount spent for an {@link IHbarSpendingPlan}.
   * @param id - The ID of the plan to get the key for.
   * @private
   */
  private getAmountSpentKey(id: string): string {
    return `${HbarSpendingPlanRepository.collectionKey}:${id}:amountSpent`;
  }

  /**
   * Gets the cache key for the spending history for an {@link IHbarSpendingPlan}.
   * @param id - The ID of the plan to get the key for.
   * @private
   */
  private getSpendingHistoryKey(id: string): string {
    return `${HbarSpendingPlanRepository.collectionKey}:${id}:spendingHistory`;
  }
}
