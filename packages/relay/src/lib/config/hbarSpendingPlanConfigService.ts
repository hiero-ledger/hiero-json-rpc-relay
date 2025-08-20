// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import findConfig from 'find-config';
import fs from 'fs';
import { Logger } from 'pino';

import { EvmAddressHbarSpendingPlanRepository } from '../db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { IDetailedHbarSpendingPlan } from '../db/types/hbarLimiter/hbarSpendingPlan';
import { SubscriptionTier } from '../db/types/hbarLimiter/subscriptionTier';
import { isValidSpendingPlanConfig, SpendingPlanConfig } from '../types/spendingPlanConfig';

/**
 * Service for managing pre-configured {@link HbarSpendingPlan} entities.
 *
 * It reads the pre-configured spending plans from a JSON file and populates the cache with them.
 *
 * @see SpendingPlanConfig
 * @see SPENDING_PLANS_CONFIG
 */
export class HbarSpendingPlanConfigService {
  /**
   * The time-to-live (TTL) for the pre-configured spending plans in the cache.
   * Defaults to `-1`, which means no TTL, i.e. the data will not expire.
   *
   * @type {number}
   * @private
   */
  private readonly TTL: number = -1;

  /**
   * Creates an instance of `HbarSpendingPlanConfigService`.
   *
   * @constructor
   * @param {Logger} logger - The logger instance.
   * @param {HbarSpendingPlanRepository} hbarSpendingPlanRepository - The repository for HBAR spending plans.
   * @param {EvmAddressHbarSpendingPlanRepository} evmAddressHbarSpendingPlanRepository - The repository for EVM address associations.
   * @param {IPAddressHbarSpendingPlanRepository} ipAddressHbarSpendingPlanRepository - The repository for IP address associations.
   */
  constructor(
    private readonly logger: Logger,
    private readonly hbarSpendingPlanRepository: HbarSpendingPlanRepository,
    private readonly evmAddressHbarSpendingPlanRepository: EvmAddressHbarSpendingPlanRepository,
    private readonly ipAddressHbarSpendingPlanRepository: IPAddressHbarSpendingPlanRepository,
  ) {}

  /**
   * Returns the cache keys for the pre-configured spending plans.
   *
   * @param {Logger} logger - The logger instance.
   * @returns {Set<string>} - A set of cache keys for the pre-configured spending plans.
   */
  public static getPreconfiguredSpendingPlanKeys(logger: Logger): Set<string> {
    try {
      const { collectionKey: hbarSpendingPlanKey } = HbarSpendingPlanRepository;
      const { collectionKey: evmAddressHbarSpendingPlanKey } = EvmAddressHbarSpendingPlanRepository;
      const { collectionKey: ipAddressHbarSpendingPlanKey } = IPAddressHbarSpendingPlanRepository;

      return new Set<string>(
        this.loadSpendingPlansConfig(logger).flatMap((plan) => {
          const { id, evmAddresses = [], ipAddresses = [] } = plan;
          return [
            `${hbarSpendingPlanKey}:${id}`,
            `${hbarSpendingPlanKey}:${id}:amountSpent`,
            `${hbarSpendingPlanKey}:${id}:spendingHistory`,
            ...evmAddresses.map((evmAddress) => `${evmAddressHbarSpendingPlanKey}:${evmAddress.trim().toLowerCase()}`),
            ...ipAddresses.map((ipAddress) => `${ipAddressHbarSpendingPlanKey}:${ipAddress}`),
          ];
        }),
      );
    } catch (error: any) {
      logger.error(`Failed to get pre-configured spending plan keys: ${error.message}`);
      return new Set<string>();
    }
  }

  /**
   * Populates the database with pre-configured spending plans.
   *
   * @returns {Promise<number>} - A promise that resolves with the number of spending plans which were added or deleted.
   * @throws {Error} - If the spending plans configuration file is not found or cannot be loaded.
   */
  public async populatePreconfiguredSpendingPlans(): Promise<number> {
    const spendingPlanConfigs = HbarSpendingPlanConfigService.loadSpendingPlansConfig(this.logger);
    if (!spendingPlanConfigs.length) {
      return 0;
    }
    this.validateSpendingPlanConfig(spendingPlanConfigs);

    const existingPlans: IDetailedHbarSpendingPlan[] =
      await this.hbarSpendingPlanRepository.findAllActiveBySubscriptionTier([
        SubscriptionTier.EXTENDED,
        SubscriptionTier.PRIVILEGED,
      ]);
    const plansDeleted = await this.deleteObsoletePlans(existingPlans, spendingPlanConfigs);
    const plansAdded = await this.addNewPlans(spendingPlanConfigs, existingPlans);
    await this.updatePlanAssociations(spendingPlanConfigs);

    return plansDeleted + plansAdded;
  }

  /**
   * Loads the pre-configured spending plans from a JSON file.
   *
   * @returns {SpendingPlanConfig[]} An array of spending plan configurations.
   * @throws {Error} If the configuration file is not found or cannot be read or parsed.
   * @private
   */
  private static loadSpendingPlansConfig(logger: Logger): SpendingPlanConfig[] {
    const spendingPlanConfig = ConfigService.get('HBAR_SPENDING_PLANS_CONFIG');

    if (!spendingPlanConfig) {
      logger.trace('HBAR_SPENDING_PLANS_CONFIG is undefined');
      return [];
    }

    // Try to parse the value directly as JSON
    try {
      return JSON.parse(spendingPlanConfig) as SpendingPlanConfig[];
    } catch (jsonParseError: any) {
        logger.trace(
          'Failed to parse HBAR_SPENDING_PLAN as JSON: %s, now treating it as a file path...',
          jsonParseError.message,
        );
      try {
        const configFilePath = findConfig(spendingPlanConfig);
        if (configFilePath && fs.existsSync(configFilePath)) {
          const fileContent = fs.readFileSync(configFilePath, 'utf-8');
          return JSON.parse(fileContent) as SpendingPlanConfig[];
        } else {
            logger.trace(
              'HBAR Spending Configuration file not found at path "%s"',
              configFilePath ?? spendingPlanConfig,
            );
          return [];
        }
      } catch (fileError: any) {
        throw new Error(`File error: ${fileError.message}`);
      }
    }
  }

  /**
   * Validates the spending plan configuration.
   *
   * @param {SpendingPlanConfig[]} spendingPlans - The spending plan configurations to validate.
   * @throws {Error} If any spending plan configuration is invalid.
   * @private
   */
  private validateSpendingPlanConfig(spendingPlans: SpendingPlanConfig[]): void {
    for (const plan of spendingPlans) {
      if (!isValidSpendingPlanConfig(plan)) {
        throw new Error(`Invalid spending plan configuration: ${JSON.stringify(plan)}`);
      }
    }
  }

  /**
   * Deletes obsolete HBAR spending plans from the database.
   *
   * @param {IDetailedHbarSpendingPlan[]} existingPlans - The existing HBAR spending plans in the database.
   * @param {SpendingPlanConfig[]} spendingPlanConfigs - The current spending plan configurations.
   * @param {RequestDetails} requestDetails - The details of the current request.
   * @returns {Promise<number>} - A promise that resolves with the number of plans deleted.
   * @private
   */
  private async deleteObsoletePlans(
    existingPlans: IDetailedHbarSpendingPlan[],
    spendingPlanConfigs: SpendingPlanConfig[],
  ): Promise<number> {
    const plansToDelete = existingPlans.filter((plan) => !spendingPlanConfigs.some((spc) => spc.id === plan.id));
    for (const { id } of plansToDelete) {
      this.logger.info(
        'Deleting HBAR spending plan with ID "%s", as it is no longer in the spending plan configuration...',
        id,
      );
      await this.hbarSpendingPlanRepository.delete(id);
      await this.evmAddressHbarSpendingPlanRepository.deleteAllByPlanId(id, 'populatePreconfiguredSpendingPlans');
      await this.ipAddressHbarSpendingPlanRepository.deleteAllByPlanId(id, 'populatePreconfiguredSpendingPlans');
    }
    return plansToDelete.length;
  }

  /**
   * Adds new HBAR spending plans to the database.
   *
   * @param spendingPlanConfigs - The current spending plan configurations.
   * @param existingPlans - The existing HBAR spending plans in the database.
   * @returns - A promise that resolves with the number of plans added.
   */
  private async addNewPlans(
    spendingPlanConfigs: SpendingPlanConfig[],
    existingPlans: IDetailedHbarSpendingPlan[],
  ): Promise<number> {
    const plansToAdd = spendingPlanConfigs.filter((spc) => !existingPlans.some((plan) => plan.id === spc.id));
    for (const { id, name, subscriptionTier } of plansToAdd) {
      await this.hbarSpendingPlanRepository.create(subscriptionTier, this.TTL, id);
      this.logger.info(
        'Created HBAR spending plan "%s" with ID "%s" and subscriptionTier "%s"',
        name,
        id,
        subscriptionTier,
      );
    }
    return plansToAdd.length;
  }

  /**
   * Updates the associations of HBAR spending plans with ETH and IP addresses.
   *
   * @param spendingPlanConfigs - The current spending plan configurations.
   * @returns - A promise that resolves when the operation is complete.
   * @private
   */
  private async updatePlanAssociations(spendingPlanConfigs: SpendingPlanConfig[]): Promise<void> {
    for (const planConfig of spendingPlanConfigs) {
        this.logger.trace(
          'Updating associations for HBAR spending plan \'%s\' with ID %s...',
          planConfig.name,
          planConfig.id,
        );
      await this.deleteObsoleteEvmAddressAssociations(planConfig);
      await this.deleteObsoleteIpAddressAssociations(planConfig);
      await this.updateEvmAddressAssociations(planConfig);
      await this.updateIpAddressAssociations(planConfig);
    }
  }

  /**
   * Updates the associations of an HBAR spending plan with EVM addresses.
   *
   * @param planConfig - The spending plan configuration.
   * @returns - A promise that resolves when the operation is complete.
   * @private
   */
  private async updateEvmAddressAssociations(planConfig: SpendingPlanConfig): Promise<void> {
    const currentEvmAddresses = await this.evmAddressHbarSpendingPlanRepository
      .findAllByPlanId(planConfig.id, 'populatePreconfiguredSpendingPlans')
      .then((evmAddressPlans) => evmAddressPlans.map((plan) => plan.evmAddress));

    const addressesToDelete = currentEvmAddresses.filter(
      (evmAddress) => !planConfig.evmAddresses?.includes(evmAddress),
    );
    await Promise.all(
      addressesToDelete.map(async (evmAddress) => {
        await this.evmAddressHbarSpendingPlanRepository.delete(evmAddress);
        this.logger.info(
          'Removed association between EVM address %s and HBAR spending plan \'%s\'',
          evmAddress,
          planConfig.name,
        );
      }),
    );

    const addressesToAdd =
      planConfig.evmAddresses?.filter((evmAddress) => !currentEvmAddresses.includes(evmAddress)) || [];
    await Promise.all(
      addressesToAdd.map(async (evmAddress) => {
        await this.evmAddressHbarSpendingPlanRepository.save({ evmAddress, planId: planConfig.id }, this.TTL);
        this.logger.info('Associated HBAR spending plan \'%s\' with EVM address %s', planConfig.name, evmAddress);
      }),
    );
  }

  /**
   * Updates the associations of an HBAR spending plan with IP addresses.
   *
   * @param planConfig - The spending plan configuration.
   * @returns - A promise that resolves when the operation is complete.
   * @private
   */
  private async updateIpAddressAssociations(planConfig: SpendingPlanConfig): Promise<void> {
    const currentIpAddresses = await this.ipAddressHbarSpendingPlanRepository
      .findAllByPlanId(planConfig.id, 'populatePreconfiguredSpendingPlans')
      .then((ipAddressPlans) => ipAddressPlans.map((plan) => plan.ipAddress));

    const addressesToDelete = currentIpAddresses.filter((ipAddress) => !planConfig.ipAddresses?.includes(ipAddress));
    await Promise.all(
      addressesToDelete.map(async (ipAddress) => {
        await this.ipAddressHbarSpendingPlanRepository.delete(ipAddress);
        this.logger.info('Removed association between IP address and HBAR spending plan \'%s\'', planConfig.name);
      }),
    );

    const addressesToAdd = planConfig.ipAddresses?.filter((ipAddress) => !currentIpAddresses.includes(ipAddress)) || [];
    await Promise.all(
      addressesToAdd.map(async (ipAddress) => {
        await this.ipAddressHbarSpendingPlanRepository.save({ ipAddress, planId: planConfig.id }, this.TTL);
        this.logger.info('Associated HBAR spending plan \'%s\' with IP address', planConfig.name);
      }),
    );
  }

  /**
   * Deletes obsolete EVM address associations from the cache.
   *
   * For example, if an EVM address is associated with a plan different from the one in the {@link SPENDING_PLANS_CONFIG},
   * the association is deleted from the cache to allow the new association from the configuration file to take effect.
   *
   * @param planConfig - The spending plan configuration.
   */
  private async deleteObsoleteEvmAddressAssociations(planConfig: SpendingPlanConfig) {
    for (const evmAddress of planConfig.evmAddresses || []) {
      const exists = await this.evmAddressHbarSpendingPlanRepository.existsByAddress(evmAddress);
      if (exists) {
        const evmAddressPlan = await this.evmAddressHbarSpendingPlanRepository.findByAddress(evmAddress);
        if (evmAddressPlan.planId !== planConfig.id) {
          this.logger.info(
            'Deleting association between EVM address %s and HBAR spending plan \'%s\'',
            evmAddress,
            planConfig.name,
          );
          await this.evmAddressHbarSpendingPlanRepository.delete(evmAddress);
        }
      }
    }
  }

  /**
   * Deletes obsolete IP address associations from the cache.
   *
   * For example, if an IP address is associated with a plan different from the one in the {@link SPENDING_PLANS_CONFIG},
   * the association is deleted from the cache to allow the new association from the configuration file to take effect.
   *
   * @param planConfig - The spending plan configuration.
   */
  private async deleteObsoleteIpAddressAssociations(planConfig: SpendingPlanConfig) {
    for (const ipAddress of planConfig.ipAddresses || []) {
      const exists = await this.ipAddressHbarSpendingPlanRepository.existsByAddress(ipAddress);
      if (exists) {
        const ipAddressPlan = await this.ipAddressHbarSpendingPlanRepository.findByAddress(ipAddress);
        if (ipAddressPlan.planId !== planConfig.id) {
          this.logger.info('Deleting association between IP address and HBAR spending plan \'%s\'', planConfig.name);
          await this.ipAddressHbarSpendingPlanRepository.delete(ipAddress);
        }
      }
    }
  }
}
