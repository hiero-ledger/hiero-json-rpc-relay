// SPDX-License-Identifier: Apache-2.0

import { type Counter, type Gauge, type Histogram, type Registry } from 'prom-client';

import { METRICS, MetricsFactory } from '../../../../metrics';
import { type LockStrategyLabel } from '../../types/lock';

/**
 * Status label values for lock acquisition metrics.
 */
export type LockAcquisitionStatus = 'success' | 'fail';

/**
 * Operation types used as labels for Redis-related lock metrics.
 *
 * @remarks
 * - 'acquire': Attempting to acquire a lock using Redis.
 * - 'release': Releasing a lock that was previously acquired using Redis.
 * - 'heartbeat': Sending heartbeat signals to maintain Redis lock queue entries.
 */
export type RedisOperationLabel = 'acquire' | 'release' | 'heartbeat';

/**
 * Service responsible for managing all lock-related metrics.
 * Provides a centralized place for metric definitions and recording methods.
 */
export class LockMetricsService {
  /**
   * Histogram tracking time spent waiting in queue to acquire a lock.
   * High values indicate contention.
   */
  private readonly waitTimeHistogram: Histogram;

  /**
   * Histogram tracking time a lock is held from acquisition to release.
   * Should be well under 30s (the max hold time).
   */
  private readonly holdDurationHistogram: Histogram;

  /**
   * Gauge tracking current number of transactions waiting in lock queues.
   */
  private readonly waitingTxnsGauge: Gauge;

  /**
   * Counter tracking lock acquisition attempts by status (success/fail).
   */
  private readonly acquisitionsCounter: Counter;

  /**
   * Counter tracking locks released due to max hold time (30s timeout).
   * Indicates hung transactions.
   */
  private readonly timeoutReleasesCounter: Counter;

  /**
   * Counter tracking zombie queue entries removed (crashed waiters detected via missing heartbeat).
   * Only applicable to Redis strategy; local strategy will always report 0.
   */
  private readonly zombieCleanupsCounter: Counter;

  /**
   * Gauge tracking currently held locks.
   */
  private readonly activeCountGauge: Gauge;

  /**
   * Counter tracking the number of Redis-related lock errors, labeled by operation type.
   * Helps monitor and diagnose issues in the Redis lock strategy.
   */
  private readonly redisLockErrors: Counter;

  /**
   * Counter tracking queue rejoins. Non-zero means a waiter found itself missing
   * from the Redis queue (restart / failover / eviction / zombie cleanup after an
   * event-loop stall) and re-pushed itself rather than looping forever.
   */
  private readonly queueRejoinsCounter: Counter;

  constructor(register: Registry) {
    const metricsFactory = new MetricsFactory(register);

    this.waitTimeHistogram = metricsFactory.histogram(METRICS.lock.waitTime);
    this.holdDurationHistogram = metricsFactory.histogram(METRICS.lock.holdDuration);
    this.waitingTxnsGauge = metricsFactory.gauge(METRICS.lock.waitingTxns);
    this.acquisitionsCounter = metricsFactory.counter(METRICS.lock.acquisitions);
    this.timeoutReleasesCounter = metricsFactory.counter(METRICS.lock.timeoutReleases);
    this.zombieCleanupsCounter = metricsFactory.counter(METRICS.lock.zombieCleanups);
    this.activeCountGauge = metricsFactory.gauge(METRICS.lock.activeCount);
    this.redisLockErrors = metricsFactory.counter(METRICS.lock.redisErrors);
    this.queueRejoinsCounter = metricsFactory.counter(METRICS.lock.queueRejoins);
  }

  /**
   * Records the time spent waiting in queue to acquire a lock.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   * @param seconds - The wait time in seconds.
   */
  recordWaitTime(strategy: LockStrategyLabel, seconds: number): void {
    this.waitTimeHistogram.labels(strategy).observe(seconds);
  }

  /**
   * Records the duration a lock was held.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   * @param seconds - The hold duration in seconds.
   */
  recordHoldDuration(strategy: LockStrategyLabel, seconds: number): void {
    this.holdDurationHistogram.labels(strategy).observe(seconds);
  }

  /**
   * Increments the waiting transactions gauge when a transaction joins the queue.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   */
  incrementWaitingTxns(strategy: LockStrategyLabel): void {
    this.waitingTxnsGauge.labels(strategy).inc();
  }

  /**
   * Decrements the waiting transactions gauge when a transaction leaves the queue.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   */
  decrementWaitingTxns(strategy: LockStrategyLabel): void {
    this.waitingTxnsGauge.labels(strategy).dec();
  }

  /**
   * Records a lock acquisition attempt.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   * @param status - The acquisition status ('success' or 'fail').
   */
  recordAcquisition(strategy: LockStrategyLabel, status: LockAcquisitionStatus): void {
    this.acquisitionsCounter.labels(strategy, status).inc();
  }

  /**
   * Records a lock released due to timeout (max hold time exceeded).
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   */
  recordTimeoutRelease(strategy: LockStrategyLabel): void {
    this.timeoutReleasesCounter.labels(strategy).inc();
  }

  /**
   * Records a zombie queue entry cleanup.
   * Only applicable to Redis strategy.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   */
  recordZombieCleanup(): void {
    this.zombieCleanupsCounter.inc();
  }

  /**
   * Increments the active locks gauge when a lock is acquired.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   */
  incrementActiveCount(strategy: LockStrategyLabel): void {
    this.activeCountGauge.labels(strategy).inc();
  }

  /**
   * Decrements the active locks gauge when a lock is released.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   */
  decrementActiveCount(strategy: LockStrategyLabel): void {
    this.activeCountGauge.labels(strategy).dec();
  }

  /**
   * Increments the Redis lock errors counter for the specified operation type.
   * Useful for tracking and monitoring Redis-related lock errors, such as
   * acquire, release, or heartbeat operation failures.
   *
   * @param operation - The Redis lock operation that encountered an error ('acquire', 'release', or 'heartbeat').
   */
  incrementRedisLockErrors(operation: RedisOperationLabel): void {
    this.redisLockErrors.labels(operation).inc();
  }

  /**
   * Records a queue rejoin event — a waiter discovered it was no longer in the Redis
   * queue and pushed itself back on. Should be zero on a healthy cluster.
   *
   * @param strategy - The lock strategy type ('local' or 'redis').
   */
  recordQueueRejoin(strategy: LockStrategyLabel): void {
    this.queueRejoinsCounter.labels(strategy).inc();
  }
}
