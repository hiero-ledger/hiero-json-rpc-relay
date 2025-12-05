// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';
import type { RedisClientType } from 'redis';

import { LocalLRUCache, MeasurableCache, RedisCache } from '../clients';
import type { ICacheClient } from '../clients/cache/ICacheClient';

const measurable = (client: ICacheClient, register: Registry, configType: 'lru' | 'redis') => {
  /**
   * Labels:
   *  callingMethod - The method initiating the cache operation
   *  cacheType - redis/lru
   *  method - The CacheService method being called
   */
  const metricName = 'rpc_cache_service_methods_counter';
  register.removeSingleMetric(metricName);
  const methodsCounter = new Counter({
    name: metricName,
    help: 'Counter for calls to methods of CacheService separated by CallingMethod and CacheType',
    registers: [register],
    labelNames: ['callingMethod', 'cacheType', 'method'],
  });

  return new MeasurableCache(client, methodsCounter, configType);
};

export class CacheClientFactory {
  static create(
    logger: Logger,
    register: Registry = new Registry(),
    reservedKeys: Set<string> = new Set(),
    redisClient?: RedisClientType,
  ): ICacheClient {
    return !ConfigService.get('TEST') && redisClient !== undefined
      ? measurable(new RedisCache(logger.child({ name: 'redisCache' }), redisClient), register, 'redis')
      : measurable(new LocalLRUCache(logger.child({ name: 'localLRUCache' }), register, reservedKeys), register, 'lru');
  }
}
