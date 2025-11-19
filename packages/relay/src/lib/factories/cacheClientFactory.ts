// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';
import { Registry } from 'prom-client';
import { RedisClientType } from 'redis';

import { LocalLRUCache, RedisCache } from '../clients';
import { ICacheClient } from '../clients/cache/ICacheClient';
import { CacheService } from '../services/cacheService/cacheService';

export class CacheClientFactory {
  static create(
    logger: Logger,
    register: Registry = new Registry(),
    reservedKeys: Set<string> = new Set(),
    redisClient?: RedisClientType,
  ): ICacheClient {
    const local = new LocalLRUCache(logger.child({ name: 'localLRUCache' }), register, reservedKeys);
    const redis =
      !ConfigService.get('TEST') && redisClient !== undefined
        ? new RedisCache(logger.child({ name: 'redisCache' }), redisClient!)
        : undefined;
    return new CacheService(logger, register, local, redis);
  }
}
