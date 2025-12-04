// SPDX-License-Identifier: Apache-2.0

import { randomBytes, uuidV4 } from 'ethers';
import { Logger } from 'pino';

import { CacheService } from '../../../services/cacheService/cacheService';
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
   * @param id - The ID of the plan to get.
   * @returns - The HBar spending plan object.
   */
  async findById(id: string): Promise<IHbarSpendingPlan> {
    const key = this.getKey(id);
    const plan = await this.cache.getAsync<IHbarSpendingPlan>(key, 'findById');
    if (!plan) {
      throw new HbarSpendingPlanNotFoundError(id);
    }
    this.logger.debug(`Retrieved subscription with ID %s`, id);
    return {
      ...plan,
      createdAt: new Date(plan.createdAt),
    };
  }

  /**
   * Gets an HBar spending plan by ID with detailed information (spendingHistory and amountSpent).
   * @param id - The ID of the plan.
   * @returns - The detailed HBar spending plan object.
   */
  async findByIdWithDetails(id: string): Promise<IDetailedHbarSpendingPlan> {
    const plan = await this.findById(id);
    return new HbarSpendingPlan({
      ...plan,
      spendingHistory: [],
      amountSpent: await this.getAmountSpent(id),
    });
  }

  /**
   * Creates a new HBar spending plan.
   * @param subscriptionTier - The subscription tier of the plan to create.
   * @param ttl - The time-to-live for the plan in milliseconds.
   * @param planId - The ID to assign to the plan. (default: generated UUID)
   * @returns - The created HBar spending plan object.
   */
  async create(subscriptionTier: SubscriptionTier, ttl: number, planId?: string): Promise<IDetailedHbarSpendingPlan> {
    const plan: IDetailedHbarSpendingPlan = {
      id: planId ?? uuidV4(randomBytes(16)),
      subscriptionTier: subscriptionTier,
      createdAt: new Date(),
      active: true,
      spendingHistory: [],
      amountSpent: 0,
    };
    this.logger.debug(`Creating HbarSpendingPlan with ID %s...`, plan.id);
    const key = this.getKey(plan.id);
    await this.cache.set(key, plan, 'create', ttl);
    return new HbarSpendingPlan(plan);
  }

  async delete(id: string): Promise<void> {
    this.logger.trace(`Deleting HbarSpendingPlan with ID %s...`, id);
    const key = this.getKey(id);
    await this.cache.delete(key, 'delete');
  }

  /**
   * Verify that an HBar spending plan exists and is active.
   * @param id - The ID of the plan.
   * @returns - A promise that resolves if the plan exists and is active, or rejects if not.
   */
  async checkExistsAndActive(id: string): Promise<void> {
    const plan = await this.findById(id);
    if (!plan.active) {
      throw new HbarSpendingPlanNotActiveError(id);
    }
  }

  /**
   * Gets the spending history for an HBar spending plan.
   * @param id - The ID of the plan.
   * @returns - A promise that resolves with the spending history.
   */
  async getSpendingHistory(id: string): Promise<IHbarSpendingRecord[]> {
    await this.checkExistsAndActive(id);

    this.logger.trace(`Retrieving spending history for HbarSpendingPlan with ID %s...`, id);
    const key = this.getSpendingHistoryKey(id);
    const spendingHistory = await this.cache.lRange<IHbarSpendingRecord>(key, 0, -1, 'getSpendingHistory');
    return spendingHistory.map((entry) => new HbarSpendingRecord(entry));
  }

  /**
   * Adds spending to a plan's spending history.
   * @param id - The ID of the plan.
   * @param amount - The amount to add to the plan's spending.
   * @returns - A promise that resolves with the new length of the spending history.
   */
  async addAmountToSpendingHistory(id: string, amount: number): Promise<number> {
    await this.checkExistsAndActive(id);

    this.logger.trace(`Adding %s to spending history for HbarSpendingPlan with ID %s...`, amount, id);
    const key = this.getSpendingHistoryKey(id);
    const entry: IHbarSpendingRecord = { amount, timestamp: new Date() };
    return this.cache.rPush(key, entry, 'addAmountToSpendingHistory');
  }

  /**
   * Gets the amount spent for an HBar spending plan.
   * @param id - The ID of the plan.
   * @returns - A promise that resolves with the amount spent.
   */
  async getAmountSpent(id: string): Promise<number> {
    await this.checkExistsAndActive(id);

    this.logger.debug(`Retrieving amountSpent for HbarSpendingPlan with ID %s...`, id);
    const key = this.getAmountSpentKey(id);
    return this.cache.getAsync(key, 'getAmountSpent').then((amountSpent) => parseInt(amountSpent ?? '0'));
  }

  /**
   * Resets the amount spent for all hbar spending plans.
   * @returns - A promise that resolves when the operation is complete.
   */
  async resetAmountSpentOfAllPlans(): Promise<void> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`Resetting the \`amountSpent\` entries for all HbarSpendingPlans...`);
    }
    const callerMethod = this.resetAmountSpentOfAllPlans.name;
    const keys = await this.cache.keys(this.getAmountSpentKey('*'), callerMethod);
    await Promise.all(keys.map((key) => this.cache.delete(key, callerMethod)));
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`Successfully reset %s "amountSpent" entries for HbarSpendingPlans.`, keys.length);
    }
  }

  /**
   * Adds an amount to the amount spent for a plan.
   * @param id - The ID of the plan.
   * @param amount - The amount to add.
   * @param ttl - The time-to-live for the amountSpent entry in milliseconds.
   * @returns - A promise that resolves when the operation is complete.
   */
  async addToAmountSpent(id: string, amount: number, ttl: number): Promise<void> {
    await this.checkExistsAndActive(id);

    const key = this.getAmountSpentKey(id);
    if (!(await this.cache.getAsync(key, 'addToAmountSpent'))) {
      this.logger.trace(`No spending yet for HbarSpendingPlan with ID %s, setting amountSpent to %s...`, id, amount);
      await this.cache.set(key, amount, 'addToAmountSpent', ttl);
    } else {
      this.logger.debug(`Adding %s to amountSpent for HbarSpendingPlan with ID %s...`, amount, id);
      await this.cache.incrBy(key, amount, 'addToAmountSpent');
    }
  }

  /**
   * Finds all active HBar spending plans by subscription tier.
   * @param tiers - The subscription tiers to filter by.
   * @returns - A promise that resolves with the active spending plans.
   */
  async findAllActiveBySubscriptionTier(tiers: SubscriptionTier[]): Promise<IDetailedHbarSpendingPlan[]> {
    const callerMethod = this.findAllActiveBySubscriptionTier.name;
    const keys = await this.cache.keys(this.getKey('*'), callerMethod);
    const plans = await Promise.all(keys.map((key) => this.cache.getAsync<IHbarSpendingPlan>(key, callerMethod)));
    return Promise.all(
      plans
        .filter((plan) => tiers.includes(plan.subscriptionTier) && plan.active)
        .map(
          async (plan) =>
            new HbarSpendingPlan({
              ...plan,
              createdAt: new Date(plan.createdAt),
              spendingHistory: [],
              amountSpent: await this.getAmountSpent(plan.id),
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
