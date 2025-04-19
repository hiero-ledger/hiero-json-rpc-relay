// SPDX-License-Identifier: Apache-2.0

import { RequestDetails } from '../types';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { CacheService } from '../services/cacheService/cacheService';

const shouldSkipCachingForSingleParams = (args: any, params: any = []) => {
  for (const item of params) {
    if (args[item.index] == item.value) {
      return true;
    }
  }

  return false;
};

const shouldSkipCachingForNamedParams = (args: any, params: any = []) => {
  for (const item of params) {
    const input = args[item.index];
    const skipList = Object.assign({}, ...params.filter(el => el.index == item.index)[0].fields.map(el => {
      return { [el.name]: el.value };
    }));

    for (const [key, value] of Object.entries(skipList)) {
      if (input[key] == value) {
        return true;
      }
    }
  }

  return false;
};

const generateCacheKey = (methodName: string, args: any) => {
  let cacheKey: string = methodName;
  for (const [, value] of Object.entries(args)) {
    if (value?.constructor?.name != 'RequestDetails') {
      if (value && typeof value === 'object') {
        for (const [key, innerValue] of Object.entries(value)) {
          cacheKey += `_${key}_${innerValue}`;
        }
        continue;
      }

      cacheKey += `_${value}`;
    }
  }

  return cacheKey;
};

const extractRequestDetails = (args: any): RequestDetails => {
  let requestId, ipAddress, connectionId: string = '';
  for (const [, value] of Object.entries(args)) {
    if (value?.constructor?.name == 'RequestDetails') {
      requestId = value['requestId'];
      ipAddress = value['ipAddress'];
      connectionId = value['connectionId'];
      break;
    }
  }

  return new RequestDetails({ requestId, ipAddress, connectionId });
};

interface CacheSingleParam {
  index: string,
  value: string
}

interface CacheNamedParam {
  name: string,
  value: string
}

interface CacheNamedParams {
  index: string,
  fields: CacheNamedParam[]
}

interface CacheOptions {
  skipParams?: CacheSingleParam[],
  skipNamedParams?: CacheNamedParams[],
  ttl?: number,
}

export function cache(cacheService: CacheService, options: CacheOptions = {}) {
  return function(_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function() {
      const requestDetails = extractRequestDetails(arguments);
      const cacheKey = generateCacheKey(method.name, arguments);

      const cachedResponse = await cacheService.getAsync(cacheKey, method, requestDetails);
      if (cachedResponse) {
        return cachedResponse;
      }

      const result = await method.apply(this, arguments);
      if (
        result &&
        !shouldSkipCachingForSingleParams(arguments, options?.skipParams) &&
        !shouldSkipCachingForNamedParams(arguments, options?.skipNamedParams)
      ) {
        await cacheService.set(
          cacheKey,
          result,
          method,
          requestDetails,
          options?.ttl ?? ConfigService.get('CACHE_TTL')
        );
      }

      return result;
    };
  };
}
