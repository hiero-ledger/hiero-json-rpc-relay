// SPDX-License-Identifier: Apache-2.0

import Piscina from 'piscina';
import { type Counter, type Gauge, type Histogram } from 'prom-client';
import { parentPort } from 'worker_threads';

import { ConfigService } from '../../../../config-service/services';
import { METRICS, MetricsFactory } from '../../../../metrics';
import { MeasurableCache, MirrorNodeClient } from '../../clients';
import { type ICacheClient } from '../../clients/cache/ICacheClient';
import { RegistryFactory } from '../../factories/registryFactory';
import { getWorkerContext, type IWorkerContext } from './workerContext';
import type { WorkerTask } from './workers';
import { unwrapError } from './WorkersErrorUtils';

/**
 * A wrapper around a shared Piscina worker thread pool.
 *
 * This class provides a globally accessible, lazily-initialized instance of a Piscina global worker pool.
 * It uses configuration values to determine the minimum and maximum thread counts.
 */
export class WorkersPool {
  /**
   * Holds the singleton Piscina instance.
   */
  private static instance: Piscina;

  /**
   * Holds the instance of MirrorNodeClient
   */
  private static mirrorNodeClient: MirrorNodeClient;

  /**
   * Holds the instance of CacheService
   */
  private static cacheService: MeasurableCache;

  /**
   * Histogram tracking the duration (in seconds) of tasks executed by the worker.
   */
  private static workerTaskDurationSecondsHistogram: Histogram;

  /**
   * Counter for the total number of tasks successfully completed by the worker.
   */
  private static workerTasksCompletedTotalCounter: Counter;

  /**
   * Counter for the total number of tasks that failed during execution by the worker (labeled by function name).
   */
  private static workerTaskFailuresCounter: Counter;

  /**
   * Histogram tracking the time (in seconds) tasks spend waiting in the worker queue before execution.
   */
  private static workerQueueWaitTimeHistogram: Histogram;

  /**
   * Gauge representing the current utilization of the worker pool (e.g., fraction of active threads).
   */
  private static workerPoolUtilizationGauge: Gauge;

  /**
   * Gauge representing the number of active threads currently running in the worker pool.
   */
  private static workerPoolActiveThreadsGauge: Gauge;

  /**
   * Gauge representing the current number of tasks waiting in the worker pool queue.
   */
  private static workerPoolQueueSizeGauge: Gauge;

  /**
   * Cached reference to the local task handler function used when {@link WORKERS_POOL_ENABLED} is `false`.
   *
   * Populated on the first invocation of {@link run} to avoid repeating the dynamic import on every call.
   */
  private static handleTaskFn: ((task: WorkerTask, ctx: IWorkerContext) => Promise<any>) | null = null;

  /**
   * Updates a metric either by delegating the update to a worker thread
   * or by executing the update locally when no worker context is present.
   *
   * If running inside a worker (i.e., `parentPort` is available), this method
   * sends a message to the parent thread containing the provided message type
   * and parameters. Otherwise, it falls back to executing the provided
   * metric update function synchronously in the current thread.
   *
   * @param messageType - The message type identifier sent to the parent thread.
   * @param params - Additional parameters to include in the message payload.
   * @param metricUpdateFunc - Callback executed locally to update the metric when no worker context is available.
   */
  public static updateMetricViaWorkerOrLocal(
    messageType: string,
    params: Record<string, any>,
    metricUpdateFunc: () => void,
  ): void {
    if (parentPort) {
      parentPort.postMessage({
        type: messageType,
        ...params,
      });
    } else {
      metricUpdateFunc();
    }
  }

  /**
   * Returns the shared Piscina worker pool instance.
   *
   * If the pool has not yet been created, it initializes a new one using configuration-based thread settings.
   *
   * @returns The globally shared `Piscina` instance.
   */
  static getInstance(): Piscina {
    if (!this.instance) {
      this.instance = new Piscina({
        filename: `${__filename.endsWith('.ts') ? __dirname.replace(/\/src\//, '/dist/') : __dirname}/workers.js`,
        atomics: 'disabled',
        minThreads: ConfigService.get('WORKERS_POOL_MIN_THREADS'),
        maxThreads: ConfigService.get('WORKERS_POOL_MAX_THREADS'),
        idleTimeout: ConfigService.get('WORKERS_POOL_IDLE_TIMEOUT_MS'),
      });

      this.instance.on('message', (msg) => {
        if (msg.type === MirrorNodeClient.ADD_LABEL_TO_MIRROR_RESPONSE_HISTOGRAM) {
          this.mirrorNodeClient[MirrorNodeClient.ADD_LABEL_TO_MIRROR_RESPONSE_HISTOGRAM](
            msg.pathLabel,
            msg.value,
            msg.ms,
          );
        }
        if (msg.type === MirrorNodeClient.ADD_LABEL_TO_MIRROR_ERROR_CODE_COUNTER) {
          this.mirrorNodeClient[MirrorNodeClient.ADD_LABEL_TO_MIRROR_ERROR_CODE_COUNTER](msg.pathLabel, msg.value);
        }
        if (msg.type === MeasurableCache.ADD_LABEL_TO_CACHE_METHODS_COUNTER) {
          this.cacheService[MeasurableCache.ADD_LABEL_TO_CACHE_METHODS_COUNTER](
            msg.callingMethod,
            msg.cacheType,
            msg.method,
          );
        }
      });

      this.initializeMetrics();
    }

    return this.instance;
  }

  /**
   * Initialize metrics related to worker threads
   */
  static initializeMetrics(): void {
    const metricsFactory = new MetricsFactory(RegistryFactory.getInstance());

    this.workerTaskDurationSecondsHistogram = metricsFactory.histogram(METRICS.workers.taskDuration);
    this.workerTasksCompletedTotalCounter = metricsFactory.counter(METRICS.workers.tasksCompleted);
    this.workerTaskFailuresCounter = metricsFactory.counter(METRICS.workers.taskFailures);
    this.workerQueueWaitTimeHistogram = metricsFactory.histogram(METRICS.workers.queueWaitTime);
    this.workerPoolUtilizationGauge = metricsFactory.gauge(METRICS.workers.poolUtilization);
    this.workerPoolActiveThreadsGauge = metricsFactory.gauge(METRICS.workers.poolActiveThreads);
    this.workerPoolQueueSizeGauge = metricsFactory.gauge(METRICS.workers.poolQueueSize);
  }

  /**
   * Executes a worker task using either the shared Piscina thread pool or the main thread,
   * depending on the {@link WORKERS_POOL_ENABLED} configuration flag.
   *
   * When the pool is enabled, the task is dispatched to a Piscina worker thread.
   *
   * When the pool is disabled, the task is executed locally on the main thread and entirely
   * bypasses the worker pool.
   *
   * @param options - The task descriptor forwarded to the worker handler.
   * @param mirrorNodeClient - Mirror node client instance used to forward inter-thread metrics.
   * @param cacheService - Cache service instance used to forward inter-thread metrics.
   * @returns A promise that resolves to the task handler's return value.
   * @throws The original error from the task handler; reconstructed from its serialized form
   *   in worker mode, or native in local mode.
   */
  static async run(options: WorkerTask, mirrorNodeClient: MirrorNodeClient, cacheService: ICacheClient): Promise<any> {
    if (!ConfigService.get('WORKERS_POOL_ENABLED')) {
      if (!this.handleTaskFn) {
        // Dynamic import to defer loading worker modules and their dependencies until actually needed.
        const mod = await import('./workers');
        this.handleTaskFn = mod.default;
      }
      // Reuse the shared per-thread cached context, built from the relay's client/cache on first use.
      return this.handleTaskFn(options, getWorkerContext(mirrorNodeClient, cacheService));
    }

    this.mirrorNodeClient = mirrorNodeClient;
    this.cacheService = cacheService as MeasurableCache;

    const taskType = (options as { type: string }).type;
    this.workerQueueWaitTimeHistogram?.observe(this.instance.histogram.waitTime.average);
    this.workerPoolUtilizationGauge?.set(this.instance.utilization);
    this.workerPoolActiveThreadsGauge?.set(this.instance.threads.length);
    this.workerPoolQueueSizeGauge?.set(this.instance.queueSize);

    const startTime = process.hrtime.bigint();
    const result = await this.getInstance()
      .run(options)
      .catch((error: unknown) => {
        const unwrappedErr = unwrapError(error);

        this.workerTaskDurationSecondsHistogram
          ?.labels(taskType)
          .observe(Number(process.hrtime.bigint() - startTime) * 1e-9);
        this.workerTaskFailuresCounter?.labels(taskType, `${unwrappedErr.name} - ${unwrappedErr.message}`).inc();

        throw unwrappedErr;
      });

    // division in floating-point math is slightly slower and may introduce rounding errors (especially when the
    // elapsed nanoseconds exceed 2^53) so using BigInt first and then multiplying by 1e-9 is safer than dividing by 1e9
    this.workerTaskDurationSecondsHistogram
      ?.labels(taskType)
      .observe(Number(process.hrtime.bigint() - startTime) * 1e-9);
    this.workerTasksCompletedTotalCounter?.labels(taskType).inc();

    return result;
  }
}
