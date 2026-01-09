// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import Piscina from 'piscina';

import { MeasurableCache, MirrorNodeClient } from '../../clients';
import { JsonRpcError, predefined } from '../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../errors/MirrorNodeClientError';
import { ICacheClient } from '../../clients/cache/ICacheClient';

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
        if (msg.type === 'addLabelToMirrorResponseHistogram') {
          this.mirrorNodeClient.addLabelToMirrorResponseHistogram(msg.pathLabel, msg.value, msg.ms);
        }
        if (msg.type === 'addLabelToMirrorErrorCodeCounter') {
          this.mirrorNodeClient.addLabelToMirrorErrorCodeCounter(msg.pathLabel, msg.value);
        }
        if (msg.type === 'addLabelToCacheMethodsCounter') {
          this.cacheService.addLabelToCacheMethodsCounter(msg.callingMethod, msg.cacheType, msg.method);
        }
      });
    }

    return this.instance;
  }

  /**
   * Executes a worker task using the shared Piscina pool.
   *
   * @param options - The data passed to the worker.
   * @param mirrorNodeClient - The mirror node client instance.
   * @param cacheService - The cache service instance.
   * @returns A promise resolving to the worker's result.
   */
  static async run(options: unknown, mirrorNodeClient: MirrorNodeClient, cacheService: ICacheClient): Promise<any> {
    this.mirrorNodeClient = mirrorNodeClient;
    this.cacheService = cacheService as MeasurableCache;

    return this.getInstance()
      .run(options)
      .catch((error: unknown) => {
        throw WorkersPool.unwrapError(error);
      });
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
