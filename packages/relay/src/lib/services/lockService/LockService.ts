// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

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
   * Logger
   *
   * @private
   */
  private readonly logger: Logger;

  /**
   * Creates a new LockService instance.
   *
   * @param strategy - The lock strategy implementation to use.
   * @param logger - The logger
   */
  constructor(strategy: LockStrategy, logger: Logger) {
    this.strategy = strategy;
    this.logger = logger;
  }

  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available (no timeout on waiting).
   *
   * @param address - The sender address to acquire the lock for.
   * @returns A promise that resolves to a unique session key.
   */
  async acquireLock(address: string): Promise<string> {
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(`Acquiring lock for address ${address}.`);
    }

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
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug(`Releasing lock for address ${address} and session key ${sessionKey}.`);
    }

    await this.strategy.releaseLock(address, sessionKey);
  }
}
