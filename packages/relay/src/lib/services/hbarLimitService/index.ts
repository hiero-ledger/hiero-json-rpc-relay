// SPDX-License-Identifier: Apache-2.0

import { zeroAddress } from '@ethereumjs/util';
import { AccountId, Hbar } from '@hashgraph/sdk';
import { Logger } from 'pino';
import { Counter, Gauge, Registry } from 'prom-client';

import { prepend0x } from '../../../formatters';
import { Utils } from '../../../utils';
import constants from '../../constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { IDetailedHbarSpendingPlan } from '../../db/types/hbarLimiter/hbarSpendingPlan';
import { SubscriptionTier } from '../../db/types/hbarLimiter/subscriptionTier';
import { RequestDetails } from '../../types';
import { IHbarLimitService } from './IHbarLimitService';

export class HbarLimitService implements IHbarLimitService {
  static readonly TIER_LIMITS: Record<SubscriptionTier, Hbar> = {
    BASIC: Hbar.fromTinybars(constants.HBAR_RATE_LIMIT_BASIC),
    EXTENDED: Hbar.fromTinybars(constants.HBAR_RATE_LIMIT_EXTENDED),
    PRIVILEGED: Hbar.fromTinybars(constants.HBAR_RATE_LIMIT_PRIVILEGED),
    OPERATOR: Hbar.fromTinybars(constants.HBAR_RATE_LIMIT_TOTAL),
  };

  /**
   * Flag to turn off the HBarRateLimitService.
   * @private
   */
  private readonly isHBarRateLimiterEnabled: boolean = true;

  /**
   * Counts the number of times the rate limit has been reached.
   * @private
   */
  private readonly hbarLimitCounter: Counter;

  /**
   * Tracks the remaining budget for the rate limiter.
   * @private
   */
  private readonly hbarLimitRemainingGauge: Gauge;

  /**
   * Tracks the total configured HBAR rate limit.
   * @private
   */
  private readonly totalHbarLimitGauge: Gauge;

  /**
   * Tracks the number of unique spending plans that have been utilized during the limit duration.
   * (i.e., plans that had expenses added to them).
   *
   * For basic spending plans, this equates to the number of unique users who have made requests during that period,
   * since each user has their own individual spending plan.
   *
   * @private
   */
  private readonly uniqueSpendingPlansCounter: Record<SubscriptionTier, Counter>;

  /**
   * Tracks the average amount of tinybars spent by spending plans per subscription tier
   * @private
   */
  private readonly averageSpendingPlanAmountSpentGauge: Record<SubscriptionTier, Gauge>;

  /**
   * The reset timestamp for the rate limiter.
   * @private
   */
  private reset: Date;

  /**
   * The operator address for the rate limiter.
   * @private
   */
  private readonly operatorAddress: string;

  constructor(
    private readonly hbarSpendingPlanRepository: HbarSpendingPlanRepository,
    private readonly evmAddressHbarSpendingPlanRepository: EvmAddressHbarSpendingPlanRepository,
    private readonly ipAddressHbarSpendingPlanRepository: IPAddressHbarSpendingPlanRepository,
    private readonly logger: Logger,
    private readonly register: Registry,
    private readonly limitDuration: number,
  ) {
    this.reset = this.getResetTimestamp();

    const operator = Utils.getOperator(logger);
    if (operator) {
      this.operatorAddress = prepend0x(AccountId.fromString(operator.accountId.toString()).toSolidityAddress());
    } else {
      this.operatorAddress = zeroAddress();
    }

    const totalBudget = HbarLimitService.TIER_LIMITS[SubscriptionTier.OPERATOR];
    if (totalBudget.toTinybars().lte(0)) {
      this.isHBarRateLimiterEnabled = false;
    }

    const metricCounterName = 'rpc_relay_hbar_rate_limit';
    this.register.removeSingleMetric(metricCounterName);
    this.hbarLimitCounter = new Counter({
      name: metricCounterName,
      help: 'Relay Hbar limit counter',
      registers: [register],
      labelNames: ['mode', 'methodName'],
    });
    this.hbarLimitCounter.inc(0);

    const rateLimiterRemainingGaugeName = 'rpc_relay_hbar_rate_remaining';
    this.register.removeSingleMetric(rateLimiterRemainingGaugeName);
    this.hbarLimitRemainingGauge = new Gauge({
      name: rateLimiterRemainingGaugeName,
      help: 'Relay Hbar rate limit remaining budget',
      registers: [register],
    });
    this.hbarLimitRemainingGauge.set(totalBudget.toTinybars().toNumber());

    const totalHbarLimitGaugeName = 'rpc_relay_hbar_rate_total_limit';
    this.register.removeSingleMetric(totalHbarLimitGaugeName);
    this.totalHbarLimitGauge = new Gauge({
      name: totalHbarLimitGaugeName,
      help: 'Total configured HBAR rate limit',
      registers: [register],
    });
    this.totalHbarLimitGauge.set(totalBudget.toTinybars().toNumber());

    this.uniqueSpendingPlansCounter = Object.values(SubscriptionTier).reduce(
      (acc, tier) => {
        const uniqueSpendingPlansCounterName = `unique_spending_plans_counter_${tier.toLowerCase()}`;
        this.register.removeSingleMetric(uniqueSpendingPlansCounterName);
        acc[tier] = new Counter({
          name: uniqueSpendingPlansCounterName,
          help: `Tracks the number of unique ${tier} spending plans used during the limit duration`,
          registers: [register],
        });
        return acc;
      },
      {} as Record<SubscriptionTier, Counter>,
    );

    this.averageSpendingPlanAmountSpentGauge = Object.values(SubscriptionTier).reduce(
      (acc, tier) => {
        const averageAmountSpentGaugeName = `average_spending_plan_amount_spent_gauge_${tier.toLowerCase()}`;
        this.register.removeSingleMetric(averageAmountSpentGaugeName);
        acc[tier] = new Gauge({
          name: averageAmountSpentGaugeName,
          help: `Tracks the average amount of tinybars spent by ${tier} spending plans`,
          registers: [register],
        });
        return acc;
      },
      {} as Record<SubscriptionTier, Gauge>,
    );

    logger.info(
      `HBAR Limiter successfully configured: totalBudget=${totalBudget}, maxLimitForBasicTier=${HbarLimitService.TIER_LIMITS.BASIC}, maxLimitForExtendedTier=${HbarLimitService.TIER_LIMITS.EXTENDED}, maxLimitForprivilegedTier=${HbarLimitService.TIER_LIMITS.PRIVILEGED}, limitDuration=${limitDuration}, resetTimeStamp=${this.reset}.`,
    );
  }

  /**
   * Checks if the rate limiter is enabled.
   * returns {boolean} - `true` if the rate limiter is enabled, otherwise `false`.
   */
  isEnabled(): boolean {
    return this.isHBarRateLimiterEnabled;
  }

  /**
   * Resets the {@link HbarSpendingPlan#amountSpent} field for all existing plans.
   * @param {RequestDetails} requestDetails - The request details used for logging and tracking.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   */
  async resetLimiter(requestDetails: RequestDetails): Promise<void> {
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} Resetting HBAR rate limiter...`);
    }
    await this.hbarSpendingPlanRepository.resetAmountSpentOfAllPlans(requestDetails);
    const remainingBudget = await this.getRemainingBudget(requestDetails);
    this.hbarLimitRemainingGauge.set(remainingBudget.toTinybars().toNumber());
    this.resetTemporaryMetrics();
    this.reset = this.getResetTimestamp();
    this.logger.info(
      `${requestDetails.formattedRequestId} HBAR Rate Limit reset: remainingBudget=${remainingBudget}, newResetTimestamp=${this.reset}`,
    );
  }

  /**
   * Checks if the given evm address or ip address should be limited.
   *
   * @param {string} mode - The mode of the transaction or request.
   * @param {string} methodName - The name of the method being invoked.
   * @param {string} txConstructorName - The name of the transaction constructor associated with the transaction.
   * @param {string} evmAddress - The evm address to check.
   * @param {RequestDetails} requestDetails The request details for logging and tracking.
   * @param {number} [estimatedTxFee] - The total estimated transaction fee, default to 0.
   * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating if the address should be limited.
   */
  async shouldLimit(
    mode: string,
    methodName: string,
    txConstructorName: string,
    evmAddress: string,
    requestDetails: RequestDetails,
    estimatedTxFee: number = 0,
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    const ipAddress = requestDetails.ipAddress;
    if (await this.isTotalBudgetExceeded(mode, methodName, txConstructorName, estimatedTxFee, requestDetails)) {
      return true;
    }

    if (!evmAddress && !ipAddress) {
      this.logger.warn(
        `${requestDetails.formattedRequestId} No evm address or ip address provided, cannot check if address should be limited.`,
      );
      return false;
    }
    const signer = `signerAddress=${evmAddress}`;
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(`${requestDetails.formattedRequestId} Checking if signer account should be limited: ${signer}`);
    }
    let spendingPlan = await this.getSpendingPlan(evmAddress, requestDetails);
    if (!spendingPlan) {
      // Create a basic spending plan if none exists for the evm address
      spendingPlan = await this.createSpendingPlanForAddress(evmAddress, requestDetails);
    }

    const spendingLimit = HbarLimitService.TIER_LIMITS[spendingPlan.subscriptionTier];

    // note: estimatedTxFee is only applicable in a few cases (currently, only for file transactions).
    //      In most situations, estimatedTxFee is set to 0 (i.e., not considered).
    //      In such cases, it should still be true if spendingPlan.amountSpent === spendingLimit.
    const exceedsLimit =
      spendingLimit.toTinybars().lte(spendingPlan.amountSpent) ||
      spendingLimit.toTinybars().lt(spendingPlan.amountSpent + estimatedTxFee);

    this.logger.info(
      `${requestDetails.formattedRequestId} Signer account ${
        exceedsLimit ? 'has' : 'has NOT'
      } exceeded HBAR rate limit threshold: ${signer}, amountSpent=${Hbar.fromTinybars(
        spendingPlan.amountSpent,
      )}, estimatedTxFee=${Hbar.fromTinybars(estimatedTxFee)}, spendingLimit=${spendingLimit}, spandingPlanId=${
        spendingPlan.id
      }, subscriptionTier=${
        spendingPlan.subscriptionTier
      }, txConstructorName=${txConstructorName}, mode=${mode}, methodName=${methodName}`,
    );

    return exceedsLimit;
  }

  /**
   * Add expense to the remaining budget and update the spending plan if applicable.
   * @param {number} cost - The cost of the expense.
   * @param {string} evmAddress - The Ethereum address to add the expense to.
   * @param {RequestDetails} requestDetails The request details for logging and tracking.
   * @returns {Promise<void>} - A promise that resolves when the expense has been added.
   */
  async addExpense(cost: number, evmAddress: string, requestDetails: RequestDetails): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const operatorPlan = await this.getOperatorSpendingPlan(requestDetails);
    await this.hbarSpendingPlanRepository.addToAmountSpent(operatorPlan.id, cost, requestDetails, this.limitDuration);
    // Done asynchronously in the background
    this.updateAverageAmountSpentPerSubscriptionTier(operatorPlan.subscriptionTier, requestDetails).then();

    const remainingBudget = await this.getRemainingBudget(requestDetails);
    this.hbarLimitRemainingGauge.set(remainingBudget.toTinybars().toNumber());

    let spendingPlan = await this.getSpendingPlan(evmAddress, requestDetails);
    if (!spendingPlan) {
      if (evmAddress) {
        // Create a basic spending plan if none exists for the evm address
        spendingPlan = await this.createSpendingPlanForAddress(evmAddress, requestDetails);
      } else {
        this.logger.warn(
          `${requestDetails.formattedRequestId} Cannot add expense to a spending plan without an evm address`,
        );
        return;
      }
    }

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestDetails.formattedRequestId} Spending plan expense update: planID=${
          spendingPlan.id
        }, subscriptionTier=${spendingPlan.subscriptionTier}, cost=${Hbar.fromTinybars(
          cost,
        )}, originalAmountSpent=${Hbar.fromTinybars(spendingPlan.amountSpent)}, updatedAmountSpent=${Hbar.fromTinybars(
          spendingPlan.amountSpent + cost,
        )}`,
      );
    }

    // Check if the spending plan is being used for the first time today
    if (spendingPlan.amountSpent === 0) {
      this.uniqueSpendingPlansCounter[spendingPlan.subscriptionTier].inc(1);
    }

    await this.hbarSpendingPlanRepository.addToAmountSpent(spendingPlan.id, cost, requestDetails, this.limitDuration);

    // Done asynchronously in the background
    this.updateAverageAmountSpentPerSubscriptionTier(spendingPlan.subscriptionTier, requestDetails).then();

    this.logger.info(
      `${requestDetails.formattedRequestId} HBAR rate limit expense update: cost=${Hbar.fromTinybars(
        cost,
      )}, remainingBudget=${remainingBudget}, spendingPlanId=${
        spendingPlan.id
      }, signerAddress=${evmAddress}, subscriptionTier=${spendingPlan.subscriptionTier}`,
    );
  }

  /**
   * Checks if the total budget of the limiter has been exceeded.
   * @param {string} mode - The mode of the transaction or request.
   * @param {string} methodName - The name of the method being invoked.
   * @param {string} txConstructorName - The name of the transaction constructor associated with the transaction.
   * @param {number} estimatedTxFee - The total estimated transaction fee, default to 0.
   * @param {RequestDetails} requestDetails The request details for logging and tracking
   * @returns {Promise<boolean>} - Resolves `true` if the total budget has been exceeded, otherwise `false`.
   * @private
   */
  private async isTotalBudgetExceeded(
    mode: string,
    methodName: string,
    txConstructorName: string,
    estimatedTxFee: number = 0,
    requestDetails: RequestDetails,
  ): Promise<boolean> {
    if (this.shouldResetLimiter()) {
      await this.resetLimiter(requestDetails);
    }
    const totalBudget = HbarLimitService.TIER_LIMITS[SubscriptionTier.OPERATOR];
    const remainingBudget = await this.getRemainingBudget(requestDetails);
    // note: estimatedTxFee is only applicable in a few cases (currently, only for file transactions).
    //      In most situations, estimatedTxFee is set to 0 (i.e., not considered).
    //      In such cases, it should still be false if remainingBudget === 0.
    if (remainingBudget.toTinybars().lte(0) || remainingBudget.toTinybars().sub(estimatedTxFee).lt(0)) {
      this.hbarLimitCounter.labels(mode, methodName).inc(1);
      this.logger.warn(
        `${
          requestDetails.formattedRequestId
        } Total HBAR rate limit reached: remainingBudget=${remainingBudget}, totalBudget=${totalBudget}, estimatedTxFee=${Hbar.fromTinybars(
          estimatedTxFee,
        )}, resetTimestamp=${this.reset.getMilliseconds()}, txConstructorName=${txConstructorName} mode=${mode}, methodName=${methodName}`,
      );
      return true;
    } else {
      if (this.logger.isLevelEnabled('debug')) {
        this.logger.debug(
          `${
            requestDetails.formattedRequestId
          } Total HBAR rate limit NOT reached: remainingBudget=${remainingBudget}, totalBudget=${totalBudget}, estimatedTxFee=${Hbar.fromTinybars(
            estimatedTxFee,
          )}, resetTimestamp=${this.reset.getMilliseconds()}, txConstructorName=${txConstructorName} mode=${mode}, methodName=${methodName}`,
        );
      }
      return false;
    }
  }

  /**
   * Updates the average amount of tinybars spent of spending plans per subscription tier.
   * @param {SubscriptionTier} subscriptionTier - The subscription tier to update the average usage for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @private {Promise<void>} - A promise that resolves when the average usage has been updated.
   */
  private async updateAverageAmountSpentPerSubscriptionTier(
    subscriptionTier: SubscriptionTier,
    requestDetails: RequestDetails,
  ): Promise<void> {
    const plans = await this.hbarSpendingPlanRepository.findAllActiveBySubscriptionTier(
      [subscriptionTier],
      requestDetails,
    );
    const totalUsage = plans.reduce((total, plan) => total + plan.amountSpent, 0);
    const averageUsage = Math.round(totalUsage / plans.length);
    this.averageSpendingPlanAmountSpentGauge[subscriptionTier].set(averageUsage);

    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${
          requestDetails.formattedRequestId
        } Updated average amount spent: subsriptionTier=${subscriptionTier}, newAverageUsage=${Hbar.fromTinybars(
          averageUsage,
        )}`,
      );
    }
  }

  /**
   * Checks if the rate limiter should be reset.
   * @returns {boolean} - `true` if the rate limiter should be reset, otherwise `false`.
   * @private
   */
  private shouldResetLimiter(): boolean {
    return Date.now() >= this.reset.getTime();
  }

  /**
   * Resets the metrics which are used to track the number of unique spending plans used during the limit duration.
   * @private
   */
  private resetTemporaryMetrics(): void {
    Object.values(SubscriptionTier).forEach((tier) => this.uniqueSpendingPlansCounter[tier].reset());
  }

  /**
   * Calculates the next reset timestamp for the rate limiter.
   *
   * This method determines the next reset timestamp based on the current reset timestamp
   * and the limit duration. If the current reset timestamp is not defined, it initializes
   * the reset timestamp to midnight of the current day. It then iteratively adds the limit
   * duration to the reset timestamp until it is in the future.
   *
   * @returns {Date} - The next reset timestamp.
   */
  private getResetTimestamp(): Date {
    const todayAtMidnight = new Date().setHours(0, 0, 0, 0);

    let resetDate = this.reset ? new Date(this.reset.getTime()) : new Date(todayAtMidnight);
    while (resetDate.getTime() < Date.now()) {
      // 1. Calculate the difference between the current time and the reset time.
      // 2. Determine how many intervals of size `limitDuration` have passed since the last reset.
      // 3. Calculate the new reset date by adding the required intervals to the original reset date.
      const intervalsPassed = Math.ceil((Date.now() - resetDate.getTime()) / this.limitDuration);
      resetDate = new Date(resetDate.getTime() + intervalsPassed * this.limitDuration);
    }

    return resetDate;
  }

  /**
   * Gets the spending plan for the given evm address or ip address.
   * @param {string} evmAddress - The evm address to get the spending plan for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IDetailedHbarSpendingPlan | null>} - A promise that resolves with the spending plan or null if none exists.
   * @private
   */
  private async getSpendingPlan(
    evmAddress: string,
    requestDetails: RequestDetails,
  ): Promise<IDetailedHbarSpendingPlan | null> {
    const ipAddress = requestDetails.ipAddress;
    if (evmAddress) {
      try {
        return await this.getSpendingPlanByEvmAddress(evmAddress, requestDetails);
      } catch (error) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`${requestDetails.formattedRequestId} Spending plan not found: evmAddress='${evmAddress}'`);
        }
      }
    }

    if (ipAddress) {
      try {
        return await this.getSpendingPlanByIPAddress(requestDetails);
      } catch (error) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`${requestDetails.formattedRequestId}  Spending plan not found for IP address.`);
        }
      }
    }

    return null;
  }

  /**
   * Gets the spending plan for the given evm address.
   * @param {string} evmAddress - The evm address to get the spending plan for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IDetailedHbarSpendingPlan>} - A promise that resolves with the spending plan.
   * @private
   */
  private async getSpendingPlanByEvmAddress(
    evmAddress: string,
    requestDetails: RequestDetails,
  ): Promise<IDetailedHbarSpendingPlan> {
    const evmAddressHbarSpendingPlan = await this.evmAddressHbarSpendingPlanRepository.findByAddress(
      evmAddress,
      requestDetails,
    );
    return this.hbarSpendingPlanRepository.findByIdWithDetails(evmAddressHbarSpendingPlan.planId, requestDetails);
  }

  /**
   * Gets the spending plan for the given IP address.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IDetailedHbarSpendingPlan>} - A promise that resolves with the spending plan.
   * @private
   */
  private async getSpendingPlanByIPAddress(requestDetails: RequestDetails): Promise<IDetailedHbarSpendingPlan> {
    const ipAddress = requestDetails.ipAddress;
    const ipAddressHbarSpendingPlan = await this.ipAddressHbarSpendingPlanRepository.findByAddress(
      ipAddress,
      requestDetails,
    );
    return this.hbarSpendingPlanRepository.findByIdWithDetails(ipAddressHbarSpendingPlan.planId, requestDetails);
  }

  /**
   * Creates a basic spending plan for the given evm address.
   * @param {string} evmAddress - The evm address to create the spending plan for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {SubscriptionTier} [subscriptionTier] - The subscription tier for the spending plan. (default = BASIC)
   * @returns {Promise<IDetailedHbarSpendingPlan>} - A promise that resolves with the created spending plan.
   * @throws {Error} - If neither evm address nor IP address is provided.
   * @private
   */
  private async createSpendingPlanForAddress(
    evmAddress: string,
    requestDetails: RequestDetails,
    subscriptionTier: SubscriptionTier = SubscriptionTier.BASIC,
  ): Promise<IDetailedHbarSpendingPlan> {
    if (!evmAddress) {
      throw new Error('Cannot create a spending plan without an associated evm address');
    }

    const spendingPlan = await this.hbarSpendingPlanRepository.create(
      subscriptionTier,
      requestDetails,
      this.limitDuration,
    );

    await this.evmAddressHbarSpendingPlanRepository.save(
      { evmAddress, planId: spendingPlan.id },
      requestDetails,
      this.limitDuration,
    );

    return spendingPlan;
  }

  /**
   * Gets the operator spending plan. If the plan does not exist, it will be created.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IDetailedHbarSpendingPlan>} - A promise that resolves with the operator spending plan.
   * @private
   */
  private async getOperatorSpendingPlan(requestDetails: RequestDetails): Promise<IDetailedHbarSpendingPlan> {
    let operatorPlan = await this.getSpendingPlan(this.operatorAddress, requestDetails);
    if (!operatorPlan) {
      this.logger.trace(`${requestDetails.formattedRequestId} Creating operator spending plan...`);
      operatorPlan = await this.createSpendingPlanForAddress(
        this.operatorAddress,
        requestDetails,
        SubscriptionTier.OPERATOR,
      );
    }
    return operatorPlan;
  }

  /**
   * Gets the remaining budget of the rate limiter. This is the total budget minus the amount spent by the operator.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<Hbar>} - A promise that resolves with the remaining budget.
   * @private
   */
  private async getRemainingBudget(requestDetails: RequestDetails): Promise<Hbar> {
    const totalBudget = HbarLimitService.TIER_LIMITS[SubscriptionTier.OPERATOR];
    try {
      const operatorPlan = await this.getOperatorSpendingPlan(requestDetails);
      return Hbar.fromTinybars(totalBudget.toTinybars().sub(operatorPlan.amountSpent));
    } catch (error) {
      this.logger.error(error);
      // If we get to here, then something went wrong with the operator spending plan.
      // In this case, we should just return the total budget, so that the rate limiter does not block all requests.
      return totalBudget;
    }
  }
}
