// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { LockStrategy } from '../../types/lock';

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
   * Logger instance for lock service operations.
   */
  private readonly logger: Logger;

  /**
   * Creates a new LockService instance.
   *
   * @param strategy - The lock strategy implementation to use.
   * @param logger - Logger instance for tracking lock operations.
   */
  constructor(strategy: LockStrategy, logger: Logger) {
    this.strategy = strategy;
    this.logger = logger.child({ name: 'lock-service' });
  }

  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available (no timeout on waiting).
   *
   * @param address - The sender address to acquire the lock for.
   * @returns A promise that resolves to a unique session key.
   */
  async acquireLock(address: string): Promise<string> {
    const sessionKey = await this.strategy.acquireLock(address);
    this.logger.debug({ address, sessionKey }, 'Lock acquired');
    return sessionKey;
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
    this.logger.debug({ address, sessionKey }, 'Lock released');
  }
}
