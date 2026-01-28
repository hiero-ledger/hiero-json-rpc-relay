// SPDX-License-Identifier: Apache-2.0

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Strategy type label values for lock metrics.
 */
export type LockStrategyLabel = 'local' | 'redis';

/**
 * Status label values for lock acquisition metrics.
 */
export type LockAcquisitionStatus = 'success' | 'fail';

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

  constructor(register: Registry) {
    // Remove existing metrics if they exist (for hot reloading scenarios)
    const metricNames = [
      'rpc_relay_lock_wait_time_seconds',
      'rpc_relay_lock_hold_duration_seconds',
      'rpc_relay_lock_waiting_txns',
      'rpc_relay_lock_acquisitions_total',
      'rpc_relay_lock_timeout_releases_total',
      'rpc_relay_lock_zombie_cleanups_total',
      'rpc_relay_lock_active_count',
    ];
    metricNames.forEach((name) => register.removeSingleMetric(name));

    this.waitTimeHistogram = new Histogram({
      name: 'rpc_relay_lock_wait_time_seconds',
      help: 'Time waiting in queue to acquire a lock. High values indicate contention.',
      labelNames: ['strategy'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [register],
    });

    this.holdDurationHistogram = new Histogram({
      name: 'rpc_relay_lock_hold_duration_seconds',
      help: 'Time a lock is held from acquisition to release. Should be well under 30s.',
      labelNames: ['strategy'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [register],
    });

    this.waitingTxnsGauge = new Gauge({
      name: 'rpc_relay_lock_waiting_txns',
      help: 'Current number of transactions waiting in lock queues (sum across all addresses).',
      labelNames: ['strategy'],
      registers: [register],
    });

    this.acquisitionsCounter = new Counter({
      name: 'rpc_relay_lock_acquisitions_total',
      help: 'Lock acquisition attempts. Status: success, fail.',
      labelNames: ['strategy', 'status'],
      registers: [register],
    });

    this.timeoutReleasesCounter = new Counter({
      name: 'rpc_relay_lock_timeout_releases_total',
      help: 'Locks released due to max hold time (30s). Indicates hung transactions.',
      labelNames: ['strategy'],
      registers: [register],
    });

    this.zombieCleanupsCounter = new Counter({
      name: 'rpc_relay_lock_zombie_cleanups_total',
      help: 'Zombie queue entries removed (crashed waiters detected via missing heartbeat). Only applicable to Redis strategy.',
      labelNames: ['strategy'],
      registers: [register],
    });

    this.activeCountGauge = new Gauge({
      name: 'rpc_relay_lock_active_count',
      help: 'Currently held locks.',
      labelNames: ['strategy'],
      registers: [register],
    });
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
  recordZombieCleanup(strategy: LockStrategyLabel): void {
    this.zombieCleanupsCounter.labels(strategy).inc();
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
}
