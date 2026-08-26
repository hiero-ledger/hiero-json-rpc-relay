// SPDX-License-Identifier: Apache-2.0

/**
 * Key namespace for trace records, shared by the local and Redis storages so the two cannot drift.
 *
 * The physical keys still differ by backing store - {@link LocalLRUCache} prepends its own `cache:` prefix -
 * but both resolve the same logical namespace from this single definition.
 */
export const TRACE_HASH_KEY_PREFIX = 'txtrace:hash:';
