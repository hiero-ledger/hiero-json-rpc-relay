// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { CacheService } from '../../../services/cacheService/cacheService';
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
   * @param evmAddress - The EVM address to check for.
   * @returns - A promise that resolves with a boolean indicating if the plan exists.
   */
  async existsByAddress(evmAddress: string): Promise<boolean> {
    const key = this.getKey(evmAddress);
    const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, 'existsByAddress');
    return !!addressPlan;
  }

  /**
   * Finds all EVM addresses associated with a spending plan.
   * @param planId - The ID of the spending plan to search for.
   * @param callingMethod - The method calling this function.
   * @returns - A promise that resolves with an array of associated plans.
   */
  async findAllByPlanId(planId: string, callingMethod: string): Promise<EvmAddressHbarSpendingPlan[]> {
    const evmAddressPlans: EvmAddressHbarSpendingPlan[] = [];
    const key = this.getKey('*');
    const keys = await this.cache.keys(key, callingMethod);
    for (const key of keys) {
      const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, callingMethod);
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
   */
  async deleteAllByPlanId(planId: string, callingMethod: string): Promise<void> {
    const key = this.getKey('*');
    const keys = await this.cache.keys(key, callingMethod);
    for (const key of keys) {
      const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, callingMethod);
      if (addressPlan?.planId === planId) {
        this.logger.trace(`Removing EVM address %s from HbarSpendingPlan with ID %s`, addressPlan.evmAddress, planId);
        await this.cache.delete(key, callingMethod);
      }
    }
  }

  /**
   * Finds an {@link EvmAddressHbarSpendingPlan} for an EVM address.
   *
   * @param evmAddress - The EVM address to search for.
   * @returns - The associated plan for the EVM address.
   */
  async findByAddress(evmAddress: string): Promise<EvmAddressHbarSpendingPlan> {
    const key = this.getKey(evmAddress);
    const addressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, 'findByAddress');
    if (!addressPlan) {
      throw new EvmAddressHbarSpendingPlanNotFoundError(evmAddress);
    }
    this.logger.debug(
      `Retrieved link between EVM address %s and HbarSpendingPlan with ID %s`,
      evmAddress,
      addressPlan.planId,
    );

    return new EvmAddressHbarSpendingPlan(addressPlan);
  }

  /**
   * Saves an {@link EvmAddressHbarSpendingPlan} to the cache, linking the plan to the EVM address.
   *
   * @param addressPlan - The plan to save.
   * @param ttl - The time-to-live for the cache entry.
   * @returns - A promise that resolves when the EVM address is linked to the plan.
   */
  async save(addressPlan: IEvmAddressHbarSpendingPlan, ttl: number): Promise<void> {
    const key = this.getKey(addressPlan.evmAddress);
    await this.cache.set(key, addressPlan, 'save', ttl);
    this.logger.debug(
      `Linked EVM address %s to HbarSpendingPlan with ID %s`,
      addressPlan.evmAddress,
      addressPlan.planId,
    );
  }

  /**
   * Deletes an {@link EvmAddressHbarSpendingPlan} from the cache, unlinking the plan from the EVM address.
   *
   * @param evmAddress - The EVM address to unlink the plan from.
   * @returns - A promise that resolves when the EVM address is unlinked from the plan.
   */
  async delete(evmAddress: string): Promise<void> {
    const key = this.getKey(evmAddress);
    const evmAddressPlan = await this.cache.getAsync<IEvmAddressHbarSpendingPlan>(key, 'delete');
    await this.cache.delete(key, 'delete');
    const errorMessage = evmAddressPlan
      ? `Removed EVM address ${evmAddress} from HbarSpendingPlan with ID ${evmAddressPlan.planId}`
      : `Trying to remove EVM address ${evmAddress}, which is not linked to a spending plan`;
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`%s`, errorMessage);
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
