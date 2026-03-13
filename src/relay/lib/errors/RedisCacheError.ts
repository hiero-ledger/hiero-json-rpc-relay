// SPDX-License-Identifier: Apache-2.0

/**
 * Represents an error that can occur when interacting with the Redis cache.
 * @class
 */
export class RedisCacheError extends Error {
  public type: string;
  public fullError?: string;
  public stack?: string;

  static ErrorMessages = {
    SOCKET_CLOSED: 'SocketClosedUnexpectedlyError',
  };

  /**
   * Creates a new RedisCacheError instance from the provided error object.
   * @constructor
   * @param {any} error - The error object representing the Redis cache error.
   */
  constructor(error: any) {
    super(error.message);
    this.name = RedisCacheError.name;
    this.type = error.type;
    this.stack = error.stack;
    this.fullError = error;
  }

  public isSocketClosed(): boolean {
    return this.type === RedisCacheError.ErrorMessages.SOCKET_CLOSED;
  }
}
