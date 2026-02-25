// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError, predefined } from '../../errors/JsonRpcError';
import { MirrorNodeClientError } from '../../errors/MirrorNodeClientError';

/**
 * Plain JSON representation of a serialized error that can be safely transferred across worker or process boundaries.
 */
export interface ErrorEnvelope {
  name: string;
  message: string;
  code?: number;
  statusCode?: number;
  data?: string;
  detail?: string;
}

/**
 * Utility for handling error serialization and deserialization across worker thread boundaries.
 */
export class WorkersErrorUtils {
  /**
   * Wraps an error into a standard `Error` instance by serializing its plain JSON representation into
   * the error message. Intended for transporting rich error information (including custom error types) across
   * boundaries such as Piscina worker threads.
   *
   * @param err - An error-like object that implements `toJSON()` or contains serializable properties.
   * @returns A new `Error` whose `message` contains a JSON-encoded representation of the original error.
   */
  public static wrapError(err: any): Error {
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
  public static unwrapError(err: unknown): Error {
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
