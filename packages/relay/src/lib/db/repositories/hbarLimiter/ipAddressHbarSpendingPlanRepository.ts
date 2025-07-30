// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { CacheService } from '../../../services/cacheService/cacheService';
import { RequestDetails } from '../../../types';
import { IPAddressHbarSpendingPlan } from '../../entities/hbarLimiter/ipAddressHbarSpendingPlan';
import { IPAddressHbarSpendingPlanNotFoundError } from '../../types/hbarLimiter/errors';
import { IIPAddressHbarSpendingPlan } from '../../types/hbarLimiter/ipAddressHbarSpendingPlan';

export class IPAddressHbarSpendingPlanRepository {
  public static readonly collectionKey = 'ipAddressHbarSpendingPlan';

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
   * Checks if an {@link IPAddressHbarSpendingPlan} exists for an IP address.
   *
   * @param {string} ipAddress - The IP address to check for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating if the plan exists.
   */
  async existsByAddress(ipAddress: string, requestDetails: RequestDetails): Promise<boolean> {
    const key = this.getKey(ipAddress);
    const addressPlan = await this.cache.getAsync<IIPAddressHbarSpendingPlan>(key, 'existsByAddress', requestDetails);
    return !!addressPlan;
  }

  /**
   * Finds all IP addresses associated with a spending plan.
   * @param {string} planId - The ID of the spending plan to search for.
   * @param {string} callingMethod - The method calling this function.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IPAddressHbarSpendingPlan[]>} - A promise that resolves with an array of associated plans.
   */
  async findAllByPlanId(
    planId: string,
    callingMethod: string,
    requestDetails: RequestDetails,
  ): Promise<IPAddressHbarSpendingPlan[]> {
    const ipAddressPlans: IPAddressHbarSpendingPlan[] = [];
    const key = this.getKey('*');
    const keys = await this.cache.keys(key, callingMethod, requestDetails);
    for (const key of keys) {
      const addressPlan = await this.cache.getAsync<IIPAddressHbarSpendingPlan>(key, callingMethod, requestDetails);
      if (addressPlan?.planId === planId) {
        ipAddressPlans.push(new IPAddressHbarSpendingPlan(addressPlan));
      }
    }
    return ipAddressPlans;
  }

  /**
   * Deletes all IP addresses associated with a spending plan.
   * @param planId - The ID of the spending plan to search for.
   * @param callingMethod - The method calling this function.
   * @param requestDetails - The request details for logging and tracking.
   */
  async deleteAllByPlanId(planId: string, callingMethod: string, requestDetails: RequestDetails): Promise<void> {
    const key = this.getKey('*');
    const keys = await this.cache.keys(key, callingMethod, requestDetails);
    for (const key of keys) {
      const addressPlan = await this.cache.getAsync<IIPAddressHbarSpendingPlan>(key, callingMethod, requestDetails);
      if (addressPlan?.planId === planId) {
        if (this.logger.isLevelEnabled('trace')) {
          this.logger.trace(`Removing IP address from HbarSpendingPlan with ID ${planId}`);
        }
        await this.cache.delete(key, callingMethod, requestDetails);
      }
    }
  }

  /**
   * Finds an {@link IPAddressHbarSpendingPlan} for an IP address.
   *
   * @param {string} ipAddress - The IP address to search for.
   * @param {RequestDetails} requestDetails - The request details for logging and tracking.
   * @returns {Promise<IPAddressHbarSpendingPlan>} - The associated plan for the IP address.
   */
  async findByAddress(ipAddress: string, requestDetails: RequestDetails): Promise<IPAddressHbarSpendingPlan> {
    const key = this.getKey(ipAddress);
    const addressPlan = await this.cache.getAsync<IIPAddressHbarSpendingPlan>(key, 'findByAddress', requestDetails);
    if (!addressPlan) {
      throw new IPAddressHbarSpendingPlanNotFoundError(ipAddress);
    }
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`Retrieved link between IP address and HbarSpendingPlan with ID ${addressPlan.planId}`);
    }
    return new IPAddressHbarSpendingPlan(addressPlan);
  }

  /**
   * Saves an {@link IPAddressHbarSpendingPlan} to the cache, linking the plan to the IP address.
   *
   * @param {IIPAddressHbarSpendingPlan} addressPlan - The plan to save.
   * @param {RequestDetails} requestDetails - The request details used for logging and tracking.
   * @param {number} ttl - The time-to-live for the cache entry.
   * @returns {Promise<void>} - A promise that resolves when the IP address is linked to the plan.
   */
  async save(addressPlan: IIPAddressHbarSpendingPlan, requestDetails: RequestDetails, ttl: number): Promise<void> {
    const key = this.getKey(addressPlan.ipAddress);
    await this.cache.set(key, addressPlan, 'save', requestDetails, ttl);
    this.logger.trace(`Linked new IP address to HbarSpendingPlan with ID ${addressPlan.planId}`);
  }

  /**
   * Deletes an {@link IPAddressHbarSpendingPlan} from the cache, unlinking the plan from the IP address.
   *
   * @param {string} ipAddress - The IP address to unlink the plan from.
   * @param {RequestDetails} requestDetails - The request details used for logging and tracking.
   * @returns {Promise<void>} - A promise that resolves when the IP address is unlinked from the plan.
   */
  async delete(ipAddress: string, requestDetails: RequestDetails): Promise<void> {
    const key = this.getKey(ipAddress);
    const ipAddressSpendingPlan = await this.cache.getAsync<IIPAddressHbarSpendingPlan>(key, 'delete', requestDetails);
    await this.cache.delete(key, 'delete', requestDetails);
    const errorMessage = ipAddressSpendingPlan
      ? `Removed IP address from HbarSpendingPlan with ID ${ipAddressSpendingPlan.planId}`
      : `Trying to remove an IP address, which is not linked to a spending plan`;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`${errorMessage}`);
    }
  }

  /**
   * Gets the cache key for an {@link IPAddressHbarSpendingPlan}.
   *
   * @param {string} ipAddress - The IP address to get the key for.
   * @private
   */
  private getKey(ipAddress: string): string {
    return `${IPAddressHbarSpendingPlanRepository.collectionKey}:${ipAddress}`;
  }
}
