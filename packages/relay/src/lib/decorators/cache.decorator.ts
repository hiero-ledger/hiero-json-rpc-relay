// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { CacheService } from '../services/cacheService/cacheService';
import { RequestDetails } from '../types';

interface CacheSingleParam {
  index: string;
  value: string;
}

interface CacheNamedParam {
  name: string;
  value: string;
}

interface CacheNamedParams {
  index: string;
  fields: CacheNamedParam[];
}

interface CacheOptions {
  skipParams?: CacheSingleParam[];
  skipNamedParams?: CacheNamedParams[];
  ttl?: number;
}

type IArgument = Record<string, any>;

/**
 * Iterates through the provided 'params' array and checks if any argument in 'args' at the specified 'index'
 * matches one of the pipe-separated values in 'value'. If a match is found, caching should be skipped.
 *
 * @param args - The IArguments arguments object
 * @param params - An array of CacheSingleParam caching rules
 * @returns 'true' if any argument matches a rule and caching should be skipped; otherwise, 'false'.
 *
 * @example
 *   [{
 *     index: '0',
 *     value: 'pending|safe'
 *   }]
 */
const shouldSkipCachingForSingleParams = (args: IArgument[], params: CacheSingleParam[] = []): boolean => {
  for (const item of params) {
    const values = item.value.split('|');
    if (values.indexOf(args[item.index]) > -1) {
      return true;
    }

    // do not cache when a parameter is missing or undefined
    // this handles cases where optional parameters are not provided
    if (!Object.prototype.hasOwnProperty.call(args, item.index) || args[item.index] === undefined) {
      return true;
    }
  }

  return false;
};

/**
 * Determines whether caching should be skipped based on field-level conditions within specific argument objects. For each
 * item in 'params', the function inspects a corresponding argument at the specified 'index' in 'args'. It builds
 * a list of field-based skip conditions and checks if any of the fields in the input argument match any of the provided
 * values (supports multiple values via pipe '|' separators).
 *
 * @param args - The function's arguments object (e.g., `IArguments`), where values are accessed by index.
 * @param params - An array of `CacheNamedParams` defining which arguments and which fields to inspect.
 * @returns `true` if any field value matches a skip condition; otherwise, `false`.
 *
 * @example
 *   [{
 *     index: '0',
 *     fields: [{
 *       name: 'fromBlock', value: 'pending|safe'
 *     }, {
 *       name: 'toBlock', value: 'safe|finalized'
 *     }],
 *   }]
 */
const shouldSkipCachingForNamedParams = (args: IArgument[], params: CacheNamedParams[] = []): boolean => {
  for (const { index, fields } of params) {
    const input = args[index];

    // build a map from field names to their match values
    const skipList: Record<string, string> = Object.fromEntries(fields.map(({ name, value }) => [name, value]));

    // check each field in the skip list
    for (const [key, value] of Object.entries(skipList)) {
      // convert "latest|safe" to ["latest", "safe"]
      const allowedValues = value.split('|');
      // get the actual value from the input object
      const actualValue = (input as IArgument)[key];

      // if the actual value is one of the values that should skip caching, return true
      if (allowedValues.includes(actualValue)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Generates a unique cache key string based on the method name and argument values. It serializes each argument (excluding
 * instances of `RequestDetails`) into a string format and appends them to the method name to form the final key.
 *
 * - If an argument is an object, each of its key-value pairs is added to the key.
 * - Primitive values are directly appended to the key.
 * - Arguments of type `RequestDetails` are ignored in the key generation.
 *
 * @param methodName - The name of the method being cached.
 * @param args - The arguments passed to the method (typically from `IArguments`).
 * @returns A string that uniquely identifies the method call for caching purposes.
 *
 * @example
 *   generateCacheKey('getBlockByNumber', arguments); // should return getBlockByNumber_0x160c_false
 */
const generateCacheKey = (methodName: string, args: IArgument[]) => {
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

/**
 * This utility is used to scan through the provided arguments (typically from `IArguments`)
 * and return the first value that is identified as an instance of `RequestDetails`.
 *
 * If no such instance is found, it returns a new `RequestDetails` object with empty defaults.
 *
 * @param args - The arguments object from a function (typically `IArguments`).
 * @returns The first found `RequestDetails` instance, or a new one with default values if none is found.
 */
const extractRequestDetails = (args: IArgument): RequestDetails => {
  for (const [, value] of Object.entries(args)) {
    if (value?.constructor?.name === 'RequestDetails') {
      return value;
    }
  }

  return new RequestDetails({ requestId: '', ipAddress: '' });
};

/**
 * This decorator uses a `CacheService` to attempt to retrieve a cached result before executing the original method. If
 * no cached response exists, the method is executed and its result may be stored in the cache depending on configurable
 * options. Caching can be conditionally skipped based on runtime arguments via `skipParams` (for positional args)
 * and `skipNamedParams` (for object args).
 *
 * @param cacheService - The caching service used to store and retrieve cache entries.
 * @param options - Optional configuration for caching behavior.
 *   @property skipParams - An array of rules for skipping caching based on specific argument values.
 *   @property skipNamedParams - An array of rules for skipping caching based on fields within argument objects.
 *   @property ttl - Optional time-to-live for the cache entry; falls back to global config if not provided.
 *
 * @returns A method decorator function that wraps the original method with caching logic.
 *
 * @example
 *   @cache(CacheService, { skipParams: [...], skipNamesParams: [...], ttl: 300 })
 */
export function cache(cacheService: CacheService, options: CacheOptions = {}) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: IArgument[]) {
      const requestDetails = extractRequestDetails(args);
      const cacheKey = generateCacheKey(method.name, args);

      const cachedResponse = await cacheService.getAsync(cacheKey, method, requestDetails);
      if (cachedResponse) {
        return cachedResponse;
      }

      const result = await method.apply(this, args);
      if (
        result &&
        !shouldSkipCachingForSingleParams(args, options?.skipParams) &&
        !shouldSkipCachingForNamedParams(args, options?.skipNamedParams)
      ) {
        await cacheService.set(
          cacheKey,
          result,
          method,
          requestDetails,
          options?.ttl ?? ConfigService.get('CACHE_TTL'),
        );
      }

      return result;
    };
  };
}

// export private methods under __test__ "namespace" but using const
// due to `ES2015 module syntax is preferred over namespaces` eslint warning
export const __test__ = {
  __private: {
    shouldSkipCachingForSingleParams,
    shouldSkipCachingForNamedParams,
    generateCacheKey,
    extractRequestDetails,
  },
};
