// SPDX-License-Identifier: Apache-2.0
// Event Loop Monitor - measures blocking and CPU usage
// Usage: Import and call startMonitoring() at app startup

import { monitorEventLoopDelay, PerformanceObserver } from 'perf_hooks';

let histogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
let intervalId: NodeJS.Timeout | null = null;

interface EventLoopMetrics {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p99: number;
  stddev: number;
}

/**
 * Start monitoring event loop delay.
 * Call this once at application startup.
 */
export function startMonitoring(intervalMs: number = 5000): void {
  if (histogram) {
    console.log('[EventLoopMonitor] Already running');
    return;
  }

  // Create histogram with 20ms resolution
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  console.log('[EventLoopMonitor] Started monitoring event loop delay');

  // Log metrics periodically
  intervalId = setInterval(() => {
    const metrics = getMetrics();
    if (metrics) {
      console.log(
        `[EventLoopMonitor] Event Loop Delay: ` +
          `min=${metrics.min.toFixed(2)}ms, ` +
          `max=${metrics.max.toFixed(2)}ms, ` +
          `mean=${metrics.mean.toFixed(2)}ms, ` +
          `p99=${metrics.p99.toFixed(2)}ms`,
      );

      // Alert if event loop is blocked
      if (metrics.max > 100) {
        console.warn(`[EventLoopMonitor] ⚠️ Event loop blocked for ${metrics.max.toFixed(0)}ms!`);
      }
    }
  }, intervalMs);
}

/**
 * Get current event loop delay metrics.
 */
export function getMetrics(): EventLoopMetrics | null {
  if (!histogram) return null;

  return {
    min: histogram.min / 1e6, // nanoseconds to milliseconds
    max: histogram.max / 1e6,
    mean: histogram.mean / 1e6,
    p50: histogram.percentile(50) / 1e6,
    p99: histogram.percentile(99) / 1e6,
    stddev: histogram.stddev / 1e6,
  };
}

/**
 * Reset the histogram (call after each test to get fresh measurements).
 */
export function reset(): void {
  if (histogram) {
    histogram.reset();
  }
}

/**
 * Stop monitoring.
 */
export function stopMonitoring(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (histogram) {
    histogram.disable();
    histogram = null;
  }
  console.log('[EventLoopMonitor] Stopped monitoring');
}

// Simple blocking detector using setInterval
let lastTick = process.hrtime();
let blockingIntervalId: NodeJS.Timeout | null = null;

/**
 * Start a simple blocking detector that logs when the event loop is blocked.
 */
export function startBlockingDetector(thresholdNS: number = 150000000): void {
  lastTick = process.hrtime();

  blockingIntervalId = setInterval(() => {
    const diff = process.hrtime(lastTick);
    const nanoseconds = diff[0] * 1e9 + diff[1];
    if (nanoseconds > thresholdNS) {
      console.warn(`[BlockingDetector] 🚨 Event loop was blocked for ~${nanoseconds}ms`);
    }

    lastTick = process.hrtime();
  }, 100);
}

export function stopBlockingDetector(): void {
  if (blockingIntervalId) {
    clearInterval(blockingIntervalId);
    blockingIntervalId = null;
  }
}
