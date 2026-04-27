// SPDX-License-Identifier: Apache-2.0

import { parentPort } from 'worker_threads';

import { JsonRpcError, predefined } from '../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../errors/MirrorNodeClientError';

/**
 * Plain JSON representation of a serializable error that can be safely transported
 * across worker thread boundaries using the Structured Clone algorithm.
 *
 * Piscina communicates task results and errors between threads via `postMessage`, which
 * uses Structured Clone. Only plain data survives this boundary — class instances, prototype
 * chains, and private fields are stripped. This envelope captures the fields needed to
 * reconstruct supported error types on the receiving thread.
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
 * Conditionally serializes an error for cross-thread transport.
 *
 * When invoked inside a Piscina worker thread (`parentPort` is non-null), serializes the
 * error into a standard {@link Error} whose `message` contains the JSON-encoded payload.
 * This ensures that rich error types (e.g. {@link JsonRpcError}, {@link MirrorNodeClientError})
 * survive the Structured Clone boundary used by `postMessage`, which otherwise strips
 * prototype chains and class-specific fields.
 *
 * When invoked on the main thread (`parentPort` is null), returns the original error
 * unchanged. This avoids the CPU/memory overhead of unnecessary serialization-deserialization
 * cycles during local execution on the main thread (e.g. when WORKERS_POOL_ENABLED is false)
 * and preserves the original object's identity.
 *
 * @param err - The error-like value to wrap if in a worker context.
 * @returns The original error when called outside a worker, or a JSON-encoded `Error` inside one.
 */
export function wrapError(err: unknown): unknown {
  if (!parentPort) {
    return err;
  }
  return new Error(JSON.stringify(err));
}

/**
 * Reconstructs the original typed error from an error previously produced by {@link wrapError}.
 *
 * Parses the JSON payload embedded in `err.message` and attempts to reconstruct one of the
 * supported rich error types. Returns a predefined internal error if the input is not an
 * `Error`, the message is not valid JSON, or the error name is unrecognised.
 *
 * Supported error types:
 * - {@link JsonRpcError}
 * - {@link MirrorNodeClientError}
 *
 * @param err - An error whose `message` is expected to contain a JSON-encoded {@link ErrorEnvelope}.
 * @returns The reconstructed typed error, or a {@link predefined.INTERNAL_ERROR} if the
 *   envelope cannot be parsed or the type is unsupported.
 */
export function unwrapError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return predefined.INTERNAL_ERROR('Failed unwrapping piscina error: value is not an Error instance.');
  }

  let parsedErr: ErrorEnvelope;
  try {
    parsedErr = JSON.parse(err.message) as ErrorEnvelope;
  } catch {
    return predefined.INTERNAL_ERROR('Failed parsing wrapped piscina error while unwrapping.');
  }

  switch (parsedErr?.name) {
    case JsonRpcError.name: {
      if (typeof parsedErr.code !== 'number') {
        return predefined.INTERNAL_ERROR(
          'Failed unwrapping piscina error: missing numeric code in JsonRpcError envelope.',
        );
      }
      return new JsonRpcError({
        code: parsedErr.code,
        data: parsedErr.data,
        message: parsedErr.message,
      });
    }

    case MirrorNodeClientError.name: {
      if (typeof parsedErr.statusCode !== 'number') {
        return predefined.INTERNAL_ERROR(
          'Failed unwrapping piscina error: missing numeric statusCode in MirrorNodeClientError envelope.',
        );
      }
      return MirrorNodeClientError.fromJSON(parsedErr.statusCode, parsedErr.message, parsedErr.data, parsedErr.detail);
    }

    default:
      return predefined.INTERNAL_ERROR('Failed unwrapping piscina error.');
  }
}
