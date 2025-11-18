// SPDX-License-Identifier: Apache-2.0

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

  /**
   * Creates a new LockService instance.
   *
   * @param strategy - The lock strategy implementation to use.
   */
  constructor(strategy: LockStrategy) {
    this.strategy = strategy;
  }

  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available (no timeout on waiting).
   *
   * @param address - The sender address to acquire the lock for.
   * @returns A promise that resolves to a unique session key.
   */
  async acquireLock(address: string): Promise<string> {
    return await this.strategy.acquireLock(address);
  }

  /**
   * Releases a lock for the specified address.
   * Only succeeds if the session key matches the current lock holder.
   *
   * @param address - The sender address to release the lock for.
   * @param sessionKey - The session key obtained during lock acquisition.
   */
  async releaseLock(address: string, sessionKey: string): Promise<void> {
    await this.strategy.releaseLock(address, sessionKey);
  }
}
