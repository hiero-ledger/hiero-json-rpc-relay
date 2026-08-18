// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { Registry } from 'prom-client';

import { LocalLRUCache } from '../../clients/cache/localLRUCache';
import { type ITransactionTracingStorage, type TransactionTraceRecord } from '../../types/transactionTracing';

/**
 * Local in-memory implementation of {@link ITransactionTracingStorage}.
 *
 * Delegates to an internal {@link LocalLRUCache} for per-entry TTL and a size bound. A private
 * {@link Registry} is used for the internal cache so its `rpc_relay_cache` gauge does not clash with
 * the shared relay cache's gauge on the main registry.
 *
 * Records are stored under a dedicated `hash:<hash>` key namespace.
 */
export class LocalTransactionTracingStorage implements ITransactionTracingStorage {
  private static readonly HASH_KEY_PREFIX = 'txtrace:hash:';

  private readonly cache: LocalLRUCache;

  /** Per-entry TTL in milliseconds (`0`/`-1` = eternal). */
  private readonly ttlMs: number;

  /**
   * @param logger - Logger passed through to the internal cache.
   * @param ttlMs - Per-entry TTL in milliseconds (`0`/`-1` = eternal).
   */
  constructor(logger: Logger, ttlMs: number) {
    this.ttlMs = ttlMs;
    this.cache = new LocalLRUCache(logger.child({ name: 'tx-tracing-cache' }), new Registry());
  }

  /**
   * TTL as {@link LocalLRUCache.set} expects it: a positive ms value, or `0` for indefinite retention.
   *
   * @returns The per-entry TTL in ms, or `0` for indefinite retention.
   */
  private resolveTtl(): number {
    return this.ttlMs > 0 ? this.ttlMs : 0;
  }

  private hashKey(hash: string): string {
    return `${LocalTransactionTracingStorage.HASH_KEY_PREFIX}${hash}`;
  }

  async set(hash: string, record: TransactionTraceRecord): Promise<void> {
    await this.cache.set(this.hashKey(hash), record, this.set.name, this.resolveTtl());
  }

  async get(hash: string): Promise<TransactionTraceRecord | null> {
    return (await this.cache.get(this.hashKey(hash), this.get.name)) as TransactionTraceRecord | null;
  }
}
