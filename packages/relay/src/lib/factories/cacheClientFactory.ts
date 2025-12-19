// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';
import { Registry } from 'prom-client';
import type { RedisClientType } from 'redis';

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
