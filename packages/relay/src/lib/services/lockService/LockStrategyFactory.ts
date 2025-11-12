// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Logger } from 'pino';

import { LockStrategy } from '../../types/lock';

/**
 * Factory for creating lock strategy instances based on configuration.
 */
export class LockStrategyFactory {
  /**
   * Creates the appropriate lock strategy instance based on REDIS_ENABLED configuration.
   *
   * @param logger - Logger instance for the lock strategy.
   * @returns An instance of the appropriate lock strategy.
   * @throws Error if the strategy is not yet implemented.
   */
  static create(logger: Logger): LockStrategy {
    const useRedis = ConfigService.get('REDIS_ENABLED');
    logger.info(`Creating ${useRedis ? 'Redis' : 'Local'} lock strategy based on REDIS_ENABLED`);

    // TODO: Remove placeholder errors once strategies are implemented
    if (useRedis) {
      throw new Error('Redis lock strategy not yet implemented');
    }

    throw new Error('Local lock strategy not yet implemented');
  }
}
