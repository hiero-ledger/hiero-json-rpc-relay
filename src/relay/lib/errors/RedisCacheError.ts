// SPDX-License-Identifier: Apache-2.0

/**
 * Redacts credentials embedded in connection-string URLs, e.g.
 * `redis://user:pass@host:6379` becomes `redis://***@host:6379`.
 * Matches up to the last `@` before the host (so a password containing `@` is fully
 * redacted); an `@` in a path or query is left untouched.
 *
 * @param value - Text that may contain URLs with embedded credentials.
 * @returns The text with any URL credentials redacted.
 */
export function redactUrlCredentials(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/gi, '$1***@');
}

/**
 * Represents an error that can occur when interacting with the Redis cache.
 * @class
 */
export class RedisCacheError extends Error {
  public type: string;

  static ErrorMessages = {
    SOCKET_CLOSED: 'SocketClosedUnexpectedlyError',
  };

  /**
   * Creates a new RedisCacheError instance from the provided error object.
   * @constructor
   * @param {any} error - The error object representing the Redis cache error.
   */
  constructor(error: any) {
    super(redactUrlCredentials(error?.message ?? ''));
    this.name = RedisCacheError.name;
    this.type = error?.type;
    this.stack = redactUrlCredentials(error?.stack ?? '');
  }

  public isSocketClosed(): boolean {
    return this.type === RedisCacheError.ErrorMessages.SOCKET_CLOSED;
  }
}
