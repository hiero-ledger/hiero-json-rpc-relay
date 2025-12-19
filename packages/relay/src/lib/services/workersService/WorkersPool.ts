// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import Piscina from 'piscina';
import { Counter, Registry } from 'prom-client';

import { JsonRpcError, predefined } from '../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../errors/MirrorNodeClientError';

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

  private static registry: Registry | undefined;

  /**
   * Counter metric for tracking completed worker tasks.
   */
  private static tasksCompletedCounter: Counter | undefined;

  /**
   * Initializes the WorkersPool with a Prometheus registry.
   * Call this once from the main thread during application startup.
   *
   * @param registry - The Prometheus registry from the main thread.
   */
  static init(registry: Registry): void {
    this.registry = registry;
    // Eagerly create the instance so metrics are ready
    this.getInstance();
  }

  /**
   * Returns the shared Piscina worker pool instance.
   *
   * If the pool has not yet been created, it initializes a new one using configuration-based thread settings.
   *
   * @param registry - Optional Prometheus registry for metrics (only used on first call).
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

      // Initialize metrics if registry was set via init()
      if (this.registry) {
        this.initMetrics();
      }
    }

    return this.instance;
  }

  /**
   * Initializes Prometheus metrics for the worker pool.
   */
  private static initMetrics(): void {
    if (!this.registry) return;

    const metricName = 'rpc_relay_workers_pool_tasks_completed_total';
    this.registry.removeSingleMetric(metricName);

    this.tasksCompletedCounter = new Counter({
      name: metricName,
      help: 'Total number of tasks completed by the worker pool',
      labelNames: ['task_type', 'status'],
      registers: [this.registry],
    });
  }

  /**
   * Executes a worker task using the shared Piscina pool.
   *
   * @param options - The data passed to the worker (should include 'type' for metric labeling).
   * @returns A promise resolving to the worker's result.
   */
  static async run(options: unknown): Promise<any> {
    const taskType = (options as { type?: string })?.type || 'unknown';

    try {
      const result = await this.getInstance().run(options);

      // Record successful task completion
      this.tasksCompletedCounter?.labels(taskType, 'success').inc();

      return result;
    } catch (error: unknown) {
      // Record failed task
      this.tasksCompletedCounter?.labels(taskType, 'error').inc();

      throw WorkersPool.unwrapError(error);
    }
  }

  /**
   * Wraps an error into a standard `Error` instance by serializing its plain JSON representation into
   * the error message. Intended for transporting rich error information (including custom error types) across
   * boundaries such as Piscina worker threads.
   *
   * @param err - An error-like object that implements `toPlainJSON()`.
   * @returns A new `Error` whose `message` contains a JSON-encoded
   */
  static wrapError(err: any): Error {
    return new Error(JSON.stringify(err.toPlainJSON()));
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
          message: parsedErr.message,
        });
      }

      case MirrorNodeClientError.name: {
        return MirrorNodeClientError.fromPlainJSON(
          parsedErr.statusCode!,
          parsedErr.message,
          parsedErr.data,
          parsedErr.detail,
        );
      }

      default:
        return predefined.INTERNAL_ERROR(`Failed unwrapping piscina error.`);
    }
  }
}
