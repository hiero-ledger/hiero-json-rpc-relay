// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type { Logger } from 'pino';
import { Registry } from 'prom-client';
import { RedisClientType } from 'redis';

import { LocalLRUCache, RedisCache } from '../clients';
import { ICacheClient } from '../clients/cache/ICacheClient';

export interface ICacheClients {
  internal: ICacheClient;
  shared: ICacheClient;
  isSharedCacheEnabled: boolean;
}

export class CacheClientFactory {
  static create(
    logger: Logger,
    register: Registry = new Registry(),
    reservedKeys: Set<string> = new Set(),
    redisClient?: RedisClientType,
  ): ICacheClients {
    const isSharedCacheEnabled = Boolean(!ConfigService.get('TEST') && redisClient);
    const internal = new LocalLRUCache(logger.child({ name: 'localLRUCache' }), register, reservedKeys);
    const shared = isSharedCacheEnabled
      ? new RedisCache(logger.child({ name: 'redisCache' }), register, redisClient!)
      : internal;
    return {
      internal,
      shared,
      isSharedCacheEnabled,
    };
  }
}
