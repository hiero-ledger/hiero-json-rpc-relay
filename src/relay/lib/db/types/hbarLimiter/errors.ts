// SPDX-License-Identifier: Apache-2.0

export class HbarSpendingPlanNotFoundError extends Error {
  constructor(id: string) {
    super(`HbarSpendingPlan with ID ${id} not found`);
    this.name = 'HbarSpendingPlanNotFoundError';
  }
}

export class HbarSpendingPlanNotActiveError extends Error {
  constructor(id: string) {
    super(`HbarSpendingPlan with ID ${id} is not active`);
    this.name = 'HbarSpendingPlanNotActiveError';
  }
}

export class EvmAddressHbarSpendingPlanNotFoundError extends Error {
  constructor(evmAddress: string) {
    super(`EvmAddressHbarSpendingPlan with address ${evmAddress} not found`);
    this.name = 'EvmAddressHbarSpendingPlanNotFoundError';
  }
}

export class IPAddressHbarSpendingPlanNotFoundError extends Error {
  constructor(ipAddress: string) {
    super(`IPAddressHbarSpendingPlan not found`);
    this.name = 'IPAddressHbarSpendingPlanNotFoundError';
  }
}
