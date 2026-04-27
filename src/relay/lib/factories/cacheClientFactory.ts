// SPDX-License-Identifier: Apache-2.0

import type { Logger } from 'pino';
import { Registry } from 'prom-client';
import type { RedisClientType } from 'redis';

import { ConfigService } from '../../../config-service/services';
import { LocalLRUCache, MeasurableCache, RedisCache } from '../clients';
import type { ICacheClient } from '../clients/cache/ICacheClient';

export class CacheClientFactory {
  static create(
    logger: Logger,
    register: Registry = new Registry(),
    reservedKeys: Set<string> = new Set(),
    redisClient?: RedisClientType,
  ): ICacheClient {
    return !ConfigService.get('TEST') && redisClient !== undefined
      ? new MeasurableCache(new RedisCache(logger.child({ name: 'redisCache' }), redisClient), register, 'redis')
      : new MeasurableCache(
          new LocalLRUCache(logger.child({ name: 'localLRUCache' }), register, reservedKeys),
          register,
          'lru',
        );
  }
}
