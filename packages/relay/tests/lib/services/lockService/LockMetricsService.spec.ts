// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Registry } from 'prom-client';

import { LockMetricsService } from '../../../../src/lib/services/lockService/LockMetricsService';

describe('LockMetricsService', function () {
  let registry: Registry;
  let metricsService: LockMetricsService;

  beforeEach(() => {
    registry = new Registry();
    metricsService = new LockMetricsService(registry);
  });

  afterEach(async () => {
    registry.clear();
  });

  /**
   * Helper to get a specific metric's value from the registry.
   * For counters and gauges, returns the numeric value.
   * For histograms, returns the sum of all observations.
   */
  async function getMetricValue(metricName: string, labels: Record<string, string> = {}): Promise<number> {
    const metrics = await registry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === metricName);

    if (!metric || !metric.values) {
      return 0;
    }
    const value = metric.values.find((v: any) => {
      return Object.entries(labels).every(([key, val]) => v.labels[key] === val);
    });

    return value?.value ?? 0;
  }

  /**
   * Helper to get histogram sum (total of all observed values).
   */
  async function getHistogramSum(metricName: string, labels: Record<string, string> = {}): Promise<number> {
    const metrics = await registry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === metricName);

    if (!metric || !metric.values) {
      return 0;
    }

    // Find the _sum value matching labels
    const sumValue = metric.values.find(
      (v: any) =>
        v.metricName === `${metricName}_sum` && Object.entries(labels).every(([key, val]) => v.labels[key] === val),
    );

    return sumValue?.value ?? 0;
  }

  /**
   * Helper to get histogram count (number of observations).
   */
  async function getHistogramCount(metricName: string, labels: Record<string, string> = {}): Promise<number> {
    const metrics = await registry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === metricName);

    if (!metric || !metric.values) {
      return 0;
    }

    // Find the _count value matching labels
    const countValue = metric.values.find(
      (v: any) =>
        v.metricName === `${metricName}_count` && Object.entries(labels).every(([key, val]) => v.labels[key] === val),
    );

    return countValue?.value ?? 0;
  }

  describe('constructor', () => {
    it('should register all metrics with the registry', async () => {
      const metricNames = [
        'rpc_relay_lock_wait_time_seconds',
        'rpc_relay_lock_hold_duration_seconds',
        'rpc_relay_lock_waiting_txns',
        'rpc_relay_lock_acquisitions_total',
        'rpc_relay_lock_timeout_releases_total',
        'rpc_relay_lock_zombie_cleanups_total',
        'rpc_relay_lock_active_count',
        'rpc_relay_lock_redis_errors_total',
      ];

      const registeredMetrics = await registry.getMetricsAsJSON();
      const registeredNames = registeredMetrics.map((m) => m.name);

      for (const name of metricNames) {
        expect(registeredNames).to.include(name, `Metric ${name} should be registered`);
      }
    });

    it('should handle re-instantiation by removing existing metrics first', () => {
      // Create a second instance with the same registry - should not throw
      const secondService = new LockMetricsService(registry);
      expect(secondService).to.be.instanceOf(LockMetricsService);
    });
  });

  describe('recordWaitTime', () => {
    it('should record wait time for local strategy with correct value', async () => {
      metricsService.recordWaitTime('local', 0.5);

      const sum = await getHistogramSum('rpc_relay_lock_wait_time_seconds', { strategy: 'local' });
      const count = await getHistogramCount('rpc_relay_lock_wait_time_seconds', { strategy: 'local' });

      expect(sum).to.equal(0.5);
      expect(count).to.equal(1);
    });

    it('should record wait time for redis strategy with correct value', async () => {
      metricsService.recordWaitTime('redis', 1.0);

      const sum = await getHistogramSum('rpc_relay_lock_wait_time_seconds', { strategy: 'redis' });
      const count = await getHistogramCount('rpc_relay_lock_wait_time_seconds', { strategy: 'redis' });

      expect(sum).to.equal(1.0);
      expect(count).to.equal(1);
    });

    it('should accumulate multiple wait time observations', async () => {
      metricsService.recordWaitTime('local', 0.5);
      metricsService.recordWaitTime('local', 1.5);
      metricsService.recordWaitTime('local', 2.0);

      const sum = await getHistogramSum('rpc_relay_lock_wait_time_seconds', { strategy: 'local' });
      const count = await getHistogramCount('rpc_relay_lock_wait_time_seconds', { strategy: 'local' });

      expect(sum).to.equal(4.0); // 0.5 + 1.5 + 2.0
      expect(count).to.equal(3);
    });
  });

  describe('recordHoldDuration', () => {
    it('should record hold duration for local strategy with correct value', async () => {
      metricsService.recordHoldDuration('local', 2.5);

      const sum = await getHistogramSum('rpc_relay_lock_hold_duration_seconds', { strategy: 'local' });
      const count = await getHistogramCount('rpc_relay_lock_hold_duration_seconds', { strategy: 'local' });

      expect(sum).to.equal(2.5);
      expect(count).to.equal(1);
    });

    it('should record hold duration for redis strategy with correct value', async () => {
      metricsService.recordHoldDuration('redis', 3.0);

      const sum = await getHistogramSum('rpc_relay_lock_hold_duration_seconds', { strategy: 'redis' });
      const count = await getHistogramCount('rpc_relay_lock_hold_duration_seconds', { strategy: 'redis' });

      expect(sum).to.equal(3.0);
      expect(count).to.equal(1);
    });

    it('should accumulate multiple hold duration observations', async () => {
      metricsService.recordHoldDuration('redis', 1.0);
      metricsService.recordHoldDuration('redis', 2.0);

      const sum = await getHistogramSum('rpc_relay_lock_hold_duration_seconds', { strategy: 'redis' });
      const count = await getHistogramCount('rpc_relay_lock_hold_duration_seconds', { strategy: 'redis' });

      expect(sum).to.equal(3.0);
      expect(count).to.equal(2);
    });
  });

  describe('waiting transactions gauge', () => {
    it('should increment waiting transactions and verify value', async () => {
      metricsService.incrementWaitingTxns('local');
      metricsService.incrementWaitingTxns('local');

      const value = await getMetricValue('rpc_relay_lock_waiting_txns', { strategy: 'local' });
      expect(value).to.equal(2);
    });

    it('should decrement waiting transactions and verify value', async () => {
      metricsService.incrementWaitingTxns('redis');
      metricsService.incrementWaitingTxns('redis');
      metricsService.incrementWaitingTxns('redis');
      metricsService.decrementWaitingTxns('redis');

      const value = await getMetricValue('rpc_relay_lock_waiting_txns', { strategy: 'redis' });
      expect(value).to.equal(2);
    });

    it('should track local and redis strategies independently', async () => {
      metricsService.incrementWaitingTxns('local');
      metricsService.incrementWaitingTxns('local');
      metricsService.incrementWaitingTxns('redis');

      const localValue = await getMetricValue('rpc_relay_lock_waiting_txns', { strategy: 'local' });
      const redisValue = await getMetricValue('rpc_relay_lock_waiting_txns', { strategy: 'redis' });

      expect(localValue).to.equal(2);
      expect(redisValue).to.equal(1);
    });
  });

  describe('recordAcquisition', () => {
    it('should record successful acquisition and verify count', async () => {
      metricsService.recordAcquisition('local', 'success');
      metricsService.recordAcquisition('local', 'success');

      const value = await getMetricValue('rpc_relay_lock_acquisitions_total', {
        strategy: 'local',
        status: 'success',
      });
      expect(value).to.equal(2);
    });

    it('should record failed acquisition and verify count', async () => {
      metricsService.recordAcquisition('redis', 'fail');

      const value = await getMetricValue('rpc_relay_lock_acquisitions_total', { strategy: 'redis', status: 'fail' });
      expect(value).to.equal(1);
    });
  });

  describe('recordTimeoutRelease', () => {
    it('should record timeout release for local strategy and verify count', async () => {
      metricsService.recordTimeoutRelease('local');
      metricsService.recordTimeoutRelease('local');

      const value = await getMetricValue('rpc_relay_lock_timeout_releases_total', { strategy: 'local' });
      expect(value).to.equal(2);
    });

    it('should record timeout release for redis strategy and verify count', async () => {
      metricsService.recordTimeoutRelease('redis');

      const value = await getMetricValue('rpc_relay_lock_timeout_releases_total', { strategy: 'redis' });
      expect(value).to.equal(1);
    });
  });

  describe('recordZombieCleanup', () => {
    it('should record zombie cleanup and verify count', async () => {
      metricsService.recordZombieCleanup();
      metricsService.recordZombieCleanup();
      metricsService.recordZombieCleanup();

      const value = await getMetricValue('rpc_relay_lock_zombie_cleanups_total');
      expect(value).to.equal(3);
    });
  });

  describe('active count gauge', () => {
    it('should increment active count and verify value', async () => {
      metricsService.incrementActiveCount('local');
      metricsService.incrementActiveCount('local');

      const value = await getMetricValue('rpc_relay_lock_active_count', { strategy: 'local' });
      expect(value).to.equal(2);
    });

    it('should decrement active count and verify value', async () => {
      metricsService.incrementActiveCount('redis');
      metricsService.incrementActiveCount('redis');
      metricsService.incrementActiveCount('redis');
      metricsService.decrementActiveCount('redis');

      const value = await getMetricValue('rpc_relay_lock_active_count', { strategy: 'redis' });
      expect(value).to.equal(2);
    });

    it('should track local and redis strategies independently', async () => {
      metricsService.incrementActiveCount('local');
      metricsService.incrementActiveCount('redis');
      metricsService.incrementActiveCount('redis');

      const localValue = await getMetricValue('rpc_relay_lock_active_count', { strategy: 'local' });
      const redisValue = await getMetricValue('rpc_relay_lock_active_count', { strategy: 'redis' });

      expect(localValue).to.equal(1);
      expect(redisValue).to.equal(2);
    });
  });

  describe('incrementRedisLockErrors', () => {
    it('should increment redis lock errors for acquire operation and verify count', async () => {
      metricsService.incrementRedisLockErrors('acquire');
      metricsService.incrementRedisLockErrors('acquire');

      const value = await getMetricValue('rpc_relay_lock_redis_errors_total', { operation: 'acquire' });
      expect(value).to.equal(2);
    });

    it('should increment redis lock errors for release operation and verify count', async () => {
      metricsService.incrementRedisLockErrors('release');

      const value = await getMetricValue('rpc_relay_lock_redis_errors_total', { operation: 'release' });
      expect(value).to.equal(1);
    });

    it('should track different operations independently', async () => {
      metricsService.incrementRedisLockErrors('acquire');
      metricsService.incrementRedisLockErrors('acquire');
      metricsService.incrementRedisLockErrors('release');
      metricsService.incrementRedisLockErrors('heartbeat');

      const acquireValue = await getMetricValue('rpc_relay_lock_redis_errors_total', { operation: 'acquire' });
      const releaseValue = await getMetricValue('rpc_relay_lock_redis_errors_total', { operation: 'release' });
      const heartbeatValue = await getMetricValue('rpc_relay_lock_redis_errors_total', { operation: 'heartbeat' });

      expect(acquireValue).to.equal(2);
      expect(releaseValue).to.equal(1);
      expect(heartbeatValue).to.equal(1);
    });
  });
});
