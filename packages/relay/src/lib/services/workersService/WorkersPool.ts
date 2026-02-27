// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import type Piscina from 'piscina';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { parentPort } from 'worker_threads';

import { MeasurableCache, MirrorNodeClient } from '../../clients';
import { ICacheClient } from '../../clients/cache/ICacheClient';
import { RegistryFactory } from '../../factories/registryFactory';
import { WorkersErrorUtils } from './WorkersErrorUtils';

/**
 * A wrapper around a shared Piscina worker thread pool with support for a local bypass mode.
 *
 * This class provides a globally accessible, lazily-initialized instance of a Piscina worker pool.
 * It also supports a "local" execution mode where tasks are executed directly on the main event loop,
 * which is critical for low-memory environments (e.g., 128MB limits) where V8 isolate overhead
 * would cause OOM kills.
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
   * Updates a metric either by delegating the update to a worker thread
   * or by executing the update locally when no worker context is present.
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
   * Piscina is loaded via dynamic `import()` to avoid pulling the module into memory when
   * `WORKERS_POOL_ENABLED` is `false` (the default for Solo / low-memory deployments).
   *
   * @returns A promise that resolves to the globally shared `Piscina` instance.
   */
  static async getInstance(): Promise<Piscina> {
    if (!this.instance) {
      const { default: PiscinaPool } = await import('piscina');
      this.instance = new PiscinaPool({
        filename: `${__dirname}/workers.js`,
        atomics: 'disabled',
        minThreads: ConfigService.get('WORKERS_POOL_MIN_THREADS'),
        maxThreads: ConfigService.get('WORKERS_POOL_MAX_THREADS'),
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
    const registry: Registry = RegistryFactory.getInstance();

    const workerTaskDurationSecondsName = 'rpc_relay_worker_task_duration_seconds';
    registry.removeSingleMetric(workerTaskDurationSecondsName);
    this.workerTaskDurationSecondsHistogram = new Histogram({
      name: workerTaskDurationSecondsName,
      help: 'Tracks how long each task takes to execute (in seconds).',
      labelNames: ['function'],
      registers: [registry],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 90, 120],
    });

    const workerTasksCompletedTotalName = 'rpc_relay_worker_tasks_completed_total';
    registry.removeSingleMetric(workerTasksCompletedTotalName);
    this.workerTasksCompletedTotalCounter = new Counter({
      name: workerTasksCompletedTotalName,
      help: 'Counts total tasks by type.',
      labelNames: ['function'],
      registers: [registry],
    });

    const workerTaskFailuresTotalName = 'rpc_relay_worker_task_failures_total';
    registry.removeSingleMetric(workerTaskFailuresTotalName);
    this.workerTaskFailuresCounter = new Counter({
      name: workerTaskFailuresTotalName,
      help: 'Counts total failures by task type.',
      labelNames: ['function', 'error_type'],
      registers: [registry],
    });

    const workerQueueWaitTimeName = 'rpc_relay_worker_queue_wait_time_seconds';
    registry.removeSingleMetric(workerQueueWaitTimeName);
    this.workerQueueWaitTimeHistogram = new Histogram({
      name: workerQueueWaitTimeName,
      help: 'Time tasks have spent waiting in queue.',
      registers: [registry],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60],
    });

    const workerPoolUtilizationName = 'rpc_relay_worker_pool_utilization';
    registry.removeSingleMetric(workerPoolUtilizationName);
    this.workerPoolUtilizationGauge = new Gauge({
      name: workerPoolUtilizationName,
      help: 'Ratio (0-1) of how busy workers are.',
      registers: [registry],
    });

    const workerPoolActiveThreadsName = 'rpc_relay_worker_pool_active_threads';
    registry.removeSingleMetric(workerPoolActiveThreadsName);
    this.workerPoolActiveThreadsGauge = new Gauge({
      name: workerPoolActiveThreadsName,
      help: 'Current number of worker threads.',
      registers: [registry],
    });

    const workerPoolQueueSizeName = 'rpc_relay_worker_pool_queue_size';
    registry.removeSingleMetric(workerPoolQueueSizeName);
    this.workerPoolQueueSizeGauge = new Gauge({
      name: workerPoolQueueSizeName,
      help: 'The current number of tasks waiting to be assigned.',
      registers: [registry],
    });
  }

  /**
   * Executes a worker task either using the Piscina pool or locally on the main thread,
   * depending on the WORKERS_POOL_ENABLED configuration setting.
   *
   * @param options - The task configuration and data.
   * @param mirrorNodeClient - The mirror node client instance.
   * @param cacheService - The cache service instance.
   * @returns A promise resolving to the task's result.
   */
  static async run(options: any, mirrorNodeClient: MirrorNodeClient, cacheService: ICacheClient): Promise<any> {
    this.mirrorNodeClient = mirrorNodeClient;
    this.cacheService = cacheService as MeasurableCache;

    const taskType = options.type;
    const startTime = process.hrtime.bigint();

    try {
      let result: any;

      if (ConfigService.get('WORKERS_POOL_ENABLED')) {
        const pool = await this.getInstance();
        this.workerQueueWaitTimeHistogram?.observe(pool.histogram.waitTime.average);
        this.workerPoolUtilizationGauge?.set(pool.utilization);
        this.workerPoolActiveThreadsGauge?.set(pool.threads.length);
        this.workerPoolQueueSizeGauge?.set(pool.queueSize);

        result = await pool.run(options);
      } else {
        // In local mode, we bypass Piscina and execute the handler directly.
        // We use a dynamic import to prevent a circular dependency between WorkersPool and Workers entry points.
        const { default: handleTask } = await import('./workers');
        result = await handleTask(options);
      }

      this.recordTaskSuccess(taskType, startTime);
      return result;
    } catch (error: unknown) {
      this.recordTaskFailure(taskType, startTime, error);
      throw error;
    }
  }

  /**
   * Records metrics for a successfully completed task.
   * @private
   */
  private static recordTaskSuccess(taskType: string, startTime: bigint): void {
    const elapsedSeconds = Number(process.hrtime.bigint() - startTime) * 1e-9;
    this.workerTaskDurationSecondsHistogram?.labels(taskType).observe(elapsedSeconds);
    this.workerTasksCompletedTotalCounter?.labels(taskType).inc();
  }

  /**
   * Records metrics for a failed task and ensures the error is correctly unwrapped if it came from a worker.
   * @private
   */
  private static recordTaskFailure(taskType: string, startTime: bigint, error: any): void {
    const elapsedSeconds = Number(process.hrtime.bigint() - startTime) * 1e-9;
    const unwrappedErr =
      error instanceof Error && error.message.startsWith('{') ? WorkersErrorUtils.unwrapError(error) : error;

    this.workerTaskDurationSecondsHistogram?.labels(taskType).observe(elapsedSeconds);
    this.workerTaskFailuresCounter
      ?.labels(taskType, `${unwrappedErr.name || 'Error'} - ${unwrappedErr.message || 'unknown'}`)
      .inc();
  }

  /**
   * Static utility for wrapping errors to be sent across worker boundaries.
   * Delegated to WorkersErrorUtils.
   */
  public static wrapError(err: any): Error {
    return WorkersErrorUtils.wrapError(err);
  }

  /**
   * Static utility for unwrapping errors received from worker boundaries.
   * Delegated to WorkersErrorUtils.
   */
  public static unwrapError(err: unknown): Error {
    return WorkersErrorUtils.unwrapError(err);
  }
}
