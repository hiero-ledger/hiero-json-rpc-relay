// SPDX-License-Identifier: Apache-2.0

import { SubscriptionTier } from '../db/types/hbarLimiter/subscriptionTier';

/**
 * Represents the configuration for a spending plan.
 * Pre-configured spending plans are specified in a `spendingPlansConfig.json` file in the root of the project.
 * @interface SpendingPlanConfig
 */
export interface SpendingPlanConfig {
  /**
   * The unique identifier for the spending plan.
   */
  id: string;

  /**
   * The name of the spending plan.
   * @type {string}
   */
  name: string;

  /**
   * EVM addresses associated with the spending plan.
   * @type {string[]}
   * @optional
   */
  evmAddresses?: string[];

  /**
   * IP addresses associated with the spending plan.
   * @type {string[]}
   * @optional
   */
  ipAddresses?: string[];

  /**
   * The subscription tier associated with the spending plan.
   * @type {SubscriptionTier}
   */
  subscriptionTier: SubscriptionTier;
}

/**
 * Determines if the provided object is a valid spending plan configuration.
 * @param plan - The object to validate.
 * @returns {boolean} - True if the object is a valid {@link SpendingPlanConfig}, false otherwise.
 */
export function isValidSpendingPlanConfig(plan: unknown): plan is SpendingPlanConfig {
  const candidate = plan as Partial<SpendingPlanConfig> | null | undefined;
  return (
    candidate != null &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.subscriptionTier === 'string' &&
    Object.values(SubscriptionTier).includes(candidate.subscriptionTier) &&
    ((Array.isArray(candidate.evmAddresses) && candidate.evmAddresses.length > 0) ||
      (Array.isArray(candidate.ipAddresses) && candidate.ipAddresses.length > 0))
  );
}
