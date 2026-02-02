// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { LockStrategy } from '../../types';

/**
 * Service that manages transaction ordering through distributed locking.
 * Uses a strategy pattern to support both local (in-memory) and distributed (Redis) locking.
 */
export class LockService {
  /**
   * The underlying lock strategy implementation (Local or Redis).
   */
  private readonly strategy: LockStrategy;

  private readonly strategyType: string;

  /**
   * Creates a new LockService instance.
   *
   * @param strategy - The lock strategy implementation to use.
   */
  constructor(strategy: LockStrategy) {
    this.strategy = strategy;
    this.strategyType = strategy.type;
  }

  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available (no timeout on waiting).
   *
   * @param address - The sender address to acquire the lock for.
   * @returns A promise that resolves to a unique session key, or null if acquisition fails (fail open).
   */
  async acquireLock(address: string): Promise<string | undefined> {
    if (ConfigService.get('ENABLE_NONCE_ORDERING')) {
      return await this.strategy.acquireLock(address);
    }
  }

  /**
   * Releases a lock for the specified address.
   * Only succeeds if the session key matches the current lock holder.
   *
   * @param address - The sender address to release the lock for.
   * @param sessionKey - The session key obtained during lock acquisition.
   */
  async releaseLock(address: string, sessionKey: string): Promise<void> {
    if (ConfigService.get('ENABLE_NONCE_ORDERING')) {
      await this.strategy.releaseLock(address, sessionKey);
    }
  }

  /**
   * Normalizes an address to lowercase for consistent key generation across lock strategies.
   *
   * @param address - The address to normalize.
   * @returns The normalized address.
   */
  static normalizeAddress(address: string): string {
    return address.toLowerCase();
  }

  getStrategyType(): string {
    return this.strategyType;
  }
}
