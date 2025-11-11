// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import { LockService as ILockService, LockStrategy, LockStrategyType } from '../../types/lockService';

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

    const strategyType = this.determineStrategyType();
    this.strategy = this.createStrategy(strategyType);
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
   * Determines which lock strategy type to use based on configuration.
   * Requires explicit LOCK_STRATEGY configuration.
   *
   * @private
   * @returns Strategy type identifier.
   * @throws Error if LOCK_STRATEGY is not configured or has an invalid value.
   */
  private determineStrategyType(): LockStrategyType {
    const configuredStrategyType = ConfigService.get('LOCK_STRATEGY');
    const supportedValues = Object.values(LockStrategyType).join(', ');

    if (configuredStrategyType === null) {
      throw new Error(`LOCK_STRATEGY must be configured. Supported values are: ${supportedValues}`);
    }

    const normalizedType = String(configuredStrategyType).trim().toUpperCase() as LockStrategyType;

    if (!Object.values(LockStrategyType).includes(normalizedType)) {
      throw new Error(
        `Unsupported LOCK_STRATEGY value: "${configuredStrategyType}". Supported values are: ${supportedValues}`,
      );
    }

    this.logger.info(`Using configured lock strategy: ${normalizedType}`);
    return normalizedType;
  }

  /**
   * Creates an appropriate lock strategy instance based on the specified type.
   *
   * @private
   * @param strategyType - The type of strategy to create.
   * @returns An instance of the specified strategy.
   * @throws Error if the strategy type is not supported.
   */
  private createStrategy(strategyType: LockStrategyType): LockStrategy {
    switch (strategyType) {
      case LockStrategyType.REDIS:
        throw new Error('Redis lock strategy not yet implemented');
      case LockStrategyType.LOCAL:
        throw new Error('Local lock strategy not yet implemented');
      default:
        // This should never happen due to enum typing, but including for completeness
        throw new Error(`Unsupported strategy type: ${strategyType}`);
    }
  }
}
