// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { CacheService } from '../../../services/cacheService/cacheService';
import { RequestDetails } from '../../../types';
import { EvmAddressHbarSpendingPlan } from '../../entities/hbarLimiter/evmAddressHbarSpendingPlan';
import { EvmAddressHbarSpendingPlanNotFoundError } from '../../types/hbarLimiter/errors';
import { IEvmAddressHbarSpendingPlan } from '../../types/hbarLimiter/evmAddressHbarSpendingPlan';

export class EvmAddressHbarSpendingPlanRepository {
  public static readonly collectionKey = 'evmAddressHbarSpendingPlan';

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
   * Checks if an {@link EvmAddressHbarSpendingPlan} exists for an EVM address.
   *
   * @param {string} evmAddress - The EVM address to check for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating if the plan exists.
   */
  async existsByAddress(evmAddress: string, requestDetails: RequestDetails): Promise<boolean> {
    const key = this.getKey(evmAddress);
    const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, 'existsByAddress', requestDetails);
    return !!addressPlan;
  }

  /**
   * Finds all EVM addresses associated with a spending plan.
   * @param {string} planId - The ID of the spending plan to search for.
   * @param {string} callingMethod - The method calling this function.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<EvmAddressHbarSpendingPlan[]>} - A promise that resolves with an array of associated plans.
   */
  async findAllByPlanId(
    planId: string,
    callingMethod: string,
    requestDetails: RequestDetails,
  ): Promise<EvmAddressHbarSpendingPlan[]> {
    const evmAddressPlans: EvmAddressHbarSpendingPlan[] = [];
    const key = this.getKey('*');
    const keys = await this.cache.keys(key, callingMethod, requestDetails);
    for (const key of keys) {
      const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, callingMethod, requestDetails);
      if (addressPlan?.planId === planId) {
        evmAddressPlans.push(new EvmAddressHbarSpendingPlan(addressPlan));
      }
    }
    return evmAddressPlans;
  }

  /**
   * Deletes all EVM addresses associated with a spending plan.
   * @param planId - The ID of the spending plan to search for.
   * @param callingMethod - The method calling this function.
   * @param requestDetails - The request details for logging and tracking.
   */
  async deleteAllByPlanId(planId: string, callingMethod: string, requestDetails: RequestDetails): Promise<void> {
    const key = this.getKey('*');
    const keys = await this.cache.keys(key, callingMethod, requestDetails);
    for (const key of keys) {
      const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, callingMethod, requestDetails);
      if (addressPlan?.planId === planId) {
        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(
            `${requestDetails.formattedRequestId} Removing EVM address ${addressPlan.evmAddress} from HbarSpendingPlan with ID ${planId}`,
          );
        }
        await this.cache.delete(key, callingMethod, requestDetails);
      }
    }
  }

  /**
   * Finds an {@link EvmAddressHbarSpendingPlan} for an EVM address.
   *
   * @param {string} evmAddress - The EVM address to search for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<EvmAddressHbarSpendingPlan>} - The associated plan for the EVM address.
   */
  async findByAddress(evmAddress: string, requestDetails: RequestDetails): Promise<EvmAddressHbarSpendingPlan> {
    const key = this.getKey(evmAddress);
    const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, 'findByAddress', requestDetails);
    if (!addressPlan) {
      throw new EvmAddressHbarSpendingPlanNotFoundError(evmAddress);
    }
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${requestDetails.formattedRequestId} Retrieved link between EVM address ${evmAddress} and HbarSpendingPlan with ID ${addressPlan.planId}`,
      );
    }
    return new EvmAddressHbarSpendingPlan(addressPlan);
  }

  /**
   * Saves an {@link EvmAddressHbarSpendingPlan} to the cache, linking the plan to the EVM address.
   *
   * @param {IEvmAddressHbarSpendingPlan} addressPlan - The plan to save.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @param {number} ttl - The time-to-live for the cache entry.
   * @returns {Promise<void>} - A promise that resolves when the EVM address is linked to the plan.
   */
  async save(addressPlan: IEvmAddressHbarSpendingPlan, requestDetails: RequestDetails, ttl: number): Promise<void> {
    const key = this.getKey(addressPlan.evmAddress);
    await this.cache.set(key, addressPlan, 'save', requestDetails, ttl);
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(
        `${requestDetails.formattedRequestId} Linked EVM address ${addressPlan.evmAddress} to HbarSpendingPlan with ID ${addressPlan.planId}`,
      );
    }
  }

  /**
   * Deletes an {@link EvmAddressHbarSpendingPlan} from the cache, unlinking the plan from the EVM address.
   *
   * @param {string} evmAddress - The EVM address to unlink the plan from.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<void>} - A promise that resolves when the EVM address is unlinked from the plan.
   */
  async delete(evmAddress: string, requestDetails: RequestDetails): Promise<void> {
    const key = this.getKey(evmAddress);
    const evmAddressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, 'delete', requestDetails);
    await this.cache.delete(key, 'delete', requestDetails);
    const errorMessage = evmAddressPlan
      ? `Removed EVM address ${evmAddress} from HbarSpendingPlan with ID ${evmAddressPlan.planId}`
      : `Trying to remove EVM address ${evmAddress}, which is not linked to a spending plan`;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${requestDetails.formattedRequestId} ${errorMessage}`);
    }
  }

  /**
   * Gets the cache key for an {@link EvmAddressHbarSpendingPlan}.
   *
   * @param {string} evmAddress - The EVM address to get the key for.
   * @private
   */
  private getKey(evmAddress: string): string {
    return `${EvmAddressHbarSpendingPlanRepository.collectionKey}:${evmAddress?.trim().toLowerCase()}`;
  }
}
