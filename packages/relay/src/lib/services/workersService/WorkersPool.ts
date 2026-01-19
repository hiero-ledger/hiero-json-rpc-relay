// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import Piscina from 'piscina';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { parentPort } from 'worker_threads';

import { MeasurableCache, MirrorNodeClient } from '../../clients';
import { ICacheClient } from '../../clients/cache/ICacheClient';
import { JsonRpcError, predefined } from '../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../errors/MirrorNodeClientError';
import { RegistryFactory } from '../../factories/registryFactory';

/**
 * Plain JSON representation of a serialized error that can be safely transferred across worker or process boundaries.
 */
interface ErrorEnvelope {
  name: string;
  message: string;
  code?: number;
  statusCode?: number;
  data?: string;
  detail?: string;
}

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

  private static workerTaskDurationSecondsHistogram: Histogram;

  private static workerTasksCompletedTotalCounter: Counter;

  private static workerTaskFailuresCounter: Counter;

  private static workerQueueWaitTimeGauge: Histogram;

  private static workerPoolUtilizationGauge: Gauge;

  private static workerPoolActiveThreadsGauge: Gauge;

  private static workerPoolQueueSizeGauge: Gauge;

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
    this.workerQueueWaitTimeGauge = new Histogram({
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
   * Executes a worker task using the shared Piscina pool.
   *
   * @param options - The data passed to the worker.
   * @param mirrorNodeClient - The mirror node client instance.
   * @param cacheService - The cache service instance.
   * @returns A promise resolving to the worker's result.
   */
  static async run(options: any, mirrorNodeClient: MirrorNodeClient, cacheService: ICacheClient): Promise<any> {
    this.mirrorNodeClient = mirrorNodeClient;
    this.cacheService = cacheService as MeasurableCache;

    const startTime = process.hrtime.bigint();
    const result = await this.getInstance()
      .run(options)
      .catch((error: unknown) => {
        const unwrappedErr = WorkersPool.unwrapError(error);
        this.workerTaskFailuresCounter?.labels(options.type, `${unwrappedErr.name} - ${unwrappedErr.message}`).inc();
        throw unwrappedErr;
      });

    // division in floating-point math is slightly slower and may introduce rounding errors (especially when the
    // elapsed nanoseconds exceed 2^53) so using BigInt first and then multiplying by 1e-9 is safer than dividing by 1e9
    this.workerTaskDurationSecondsHistogram
      ?.labels(options.type)
      .observe(Number(process.hrtime.bigint() - startTime) * 1e-9);
    this.workerTasksCompletedTotalCounter?.labels(options.type).inc();
    this.workerQueueWaitTimeGauge?.observe(this.instance.histogram.waitTime.average);
    this.workerPoolUtilizationGauge?.set(this.instance.utilization);
    this.workerPoolActiveThreadsGauge?.set(this.instance.threads.length);
    this.workerPoolQueueSizeGauge?.set(this.instance.queueSize);

    return result;
  }

  /**
   * Wraps an error into a standard `Error` instance by serializing its plain JSON representation into
   * the error message. Intended for transporting rich error information (including custom error types) across
   * boundaries such as Piscina worker threads.
   *
   * @param err - An error-like object that implements `toJSON()`.
   * @returns A new `Error` whose `message` contains a JSON-encoded
   */
  static wrapError(err: any): Error {
    return new Error(JSON.stringify(err));
  }

  /**
   * Unwraps an error previously wrapped with {@link wrapError} and attempts to reconstruct the original error
   * instance. If parsing fails or the error type is unsupported, a predefined internal error is returned instead.
   *
   * Supported error types:
   * - {@link JsonRpcError}
   * - {@link MirrorNodeClientError}
   *
   * @param err - An error whose `message` is expected to contain a JSON-encoded {@link ErrorEnvelope}.
   * @returns The reconstructed error instance, or an internal error if unwrapping fails.
   */
  static unwrapError(err: unknown): Error {
    if (!(err instanceof Error)) {
      return predefined.INTERNAL_ERROR(`Failed unwrapping piscina error: value is not an Error instance.`);
    }

    let parsedErr: ErrorEnvelope;
    try {
      parsedErr = JSON.parse(err.message) as ErrorEnvelope;
    } catch {
      return predefined.INTERNAL_ERROR(`Failed parsing wrapped piscina error while unwrapping.`);
    }

    switch (parsedErr?.name) {
      case JsonRpcError.name: {
        return new JsonRpcError({
          code: parsedErr.code!,
          data: parsedErr.data!,
          message: parsedErr.message,
        });
      }

      case MirrorNodeClientError.name: {
        return MirrorNodeClientError.fromJSON(
          parsedErr.statusCode!,
          parsedErr.message,
          parsedErr.data,
          parsedErr.detail,
        );
      }

      default:
        return predefined.INTERNAL_ERROR('Failed unwrapping piscina error.');
    }
  }
}
