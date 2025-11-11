// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import { LockService as ILockService, LockStrategy } from '../../types/lockService';

/**
 * Service that manages transaction ordering through distributed locking.
 * Uses a strategy pattern to support both local (in-memory) and distributed (Redis) locking.
 */
export class LockService implements ILockService {
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
   * Automatically selects the appropriate strategy based on configuration.
   *
   * @param logger - Logger instance for tracking lock operations.
   */
  constructor(logger: Logger) {
    this.logger = logger.child({ name: 'lock-service' });
    this.strategy = this.createStrategy();
  }

  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available (no timeout on waiting).
   *
   * @param address - The sender address to acquire the lock for.
   * @returns A promise that resolves to a unique session key.
   */
  async acquireLock(address: string): Promise<string> {
    const addressLowerCased = address.toLowerCase();
    const sessionKey = await this.strategy.acquireLock(addressLowerCased);

    this.logger.debug({ address: addressLowerCased, sessionKey }, 'Lock acquired');
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
    const addressLowerCased = address.toLowerCase();
    await this.strategy.releaseLock(addressLowerCased, sessionKey);

    this.logger.debug({ address: addressLowerCased, sessionKey }, 'Lock released');
  }

  /**
   * Creates the appropriate lock strategy instance based on REDIS_ENABLED configuration.
   *
   * @private
   * @returns An instance of the appropriate lock strategy.
   * @throws Error if the strategy is not yet implemented.
   */
  private createStrategy(): LockStrategy {
    const useRedis = ConfigService.get('REDIS_ENABLED');
    this.logger.info(`Using ${useRedis ? 'Redis' : 'Local'} lock strategy based on REDIS_ENABLED`);

    // TODO: Remove placeholder errors once strategies are implemented
    if (useRedis) {
      throw new Error('Redis lock strategy not yet implemented');
    }

    throw new Error('Local lock strategy not yet implemented');
  }
}
