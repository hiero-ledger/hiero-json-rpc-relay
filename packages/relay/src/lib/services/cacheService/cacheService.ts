// SPDX-License-Identifier: Apache-2.0

/**
 * A service that manages caching using different cache implementations based on configuration.
 * Client can be used directly, instead of this service, but it is left as an alias
 * (and entrypoint for potential rewrites).
 */
export { ICacheClient as CacheService } from '../../clients/cache/ICacheClient';
