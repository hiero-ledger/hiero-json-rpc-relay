// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';
import { RedisClientType } from 'redis';

import { LocalLRUCache, RedisCache } from '../clients';
import { FallbackCache } from '../clients/cache/fallbackCache';
import { ICacheClient } from '../clients/cache/ICacheClient';
import { MeasurableCache } from '../clients/cache/measurableCache';
import { RedisCacheError } from '../errors/RedisCacheError';

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

  const config = {
    lru: new Map([
      [MeasurableCache.methods.GET_ASYNC, [MeasurableCache.methods.GET]],
      [MeasurableCache.methods.MSET, [MeasurableCache.methods.SET]],
      [MeasurableCache.methods.INCR_BY, [MeasurableCache.methods.GET, MeasurableCache.methods.SET]],
      [MeasurableCache.methods.LRANGE, [MeasurableCache.methods.GET]],
      [MeasurableCache.methods.RPUSH, [MeasurableCache.methods.GET, MeasurableCache.methods.SET]],
    ]),
    redis: ConfigService.get('MULTI_SET')
      ? new Map()
      : new Map([[MeasurableCache.methods.MSET, [MeasurableCache.methods.PIPELINE]]]),
  };

  return new MeasurableCache(client, methodsCounter, configType, config[configType]);
};

export class CacheClientFactory {
  static create(
    logger: Logger,
    register: Registry = new Registry(),
    reservedKeys: Set<string> = new Set(),
    redisClient?: RedisClientType,
  ): ICacheClient {
    const local = new LocalLRUCache(logger.child({ name: 'localLRUCache' }), register, reservedKeys);
    if (ConfigService.get('TEST') || redisClient === undefined) return measurable(local, register, 'lru');

    const redis = new RedisCache(logger.child({ name: 'redisCache' }), redisClient!);
    return new FallbackCache(
      measurable(redis, register, 'redis'),
      measurable(local, register, 'lru'),
      (message: string, previous: Error | unknown) =>
        logger.error(
          new RedisCacheError(previous),
          message.replace('{{DECORATED}}', 'Redis'),
          message.replace('{{FALLBACK}}', 'internal'),
        ),
    );
  }
}
