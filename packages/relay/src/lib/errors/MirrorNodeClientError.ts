// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hashgraph/sdk';

export class MirrorNodeClientError extends Error {
  public statusCode: number;
  public data?: string;
  public detail?: string;

  /**
   * Standard HTTP status responses used by the Mirror Node
   */
  static HttpStatusResponses = {
    BAD_GATEWAY: {
      statusCode: 502,
      message: 'Bad Gateway',
    },
    CONTRACT_REVERT_EXECUTED: {
      statusCode: 400,
      message: 'Contract Revert Executed',
    },
    ECONNABORTED: {
      statusCode: 504,
      message: 'Connection Aborted',
    },
    INTERNAL_SERVER_ERROR: {
      statusCode: 500,
      message: 'Internal Server Error',
    },
    NO_CONTENT: {
      statusCode: 204,
      message: 'No Content',
    },
    NOT_FOUND: {
      statusCode: 404,
      message: 'Not Found',
    },
    NOT_SUPPORTED: {
      statusCode: 501,
      message: 'Not Supported',
    },
    SERVICE_UNAVAILABLE: {
      statusCode: 503,
      message: 'Service Unavailable',
    },
    TOO_MANY_REQUESTS: {
      statusCode: 429,
      message: 'Too Many Requests',
    },
  };

  /**
   * Common error messages used by the Mirror Node
   */
  static messages = {
    INVALID_HEX: 'data field invalid hexadecimal string',
    CONTRACT_REVERT_EXECUTED: Status.ContractRevertExecuted.toString(),
  };

  constructor(error: any, statusCode: number) {
    // mirror node web3 module sends errors in this format, this is why we need a check to distinguish
    if (error.response?.data?._status?.messages?.length) {
      const msg = error.response.data._status.messages[0];
      const { message, detail, data } = msg;
      super(message);

      this.detail = detail;
      this.data = data;
    } else {
      super(error.message);
    }

    this.statusCode = statusCode;
    Object.setPrototypeOf(this, MirrorNodeClientError.prototype);
  }

  /**
   * Checks if the error is due to a contract revert
   *
   * @returns True if the error is a contract revert
   */
  public isContractReverted(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.CONTRACT_REVERT_EXECUTED.statusCode;
  }

  /**
   * Checks if the error is due to a contract revert opcode execution
   *
   * @returns True if the error is from a contract revert opcode
   */
  public isContractRevertOpcodeExecuted(): boolean {
    return this.message === MirrorNodeClientError.messages.CONTRACT_REVERT_EXECUTED;
  }

  /**
   * Checks if the error is a not found error
   *
   * @returns True if the resource was not found
   */
  public isNotFound(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.NOT_FOUND.statusCode;
  }

  /**
   * Checks if the response is empty (no content)
   *
   * @returns True if the response is empty
   */
  public isEmpty(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.NO_CONTENT.statusCode;
  }

  /**
   * Checks if the error is due to rate limiting
   *
   * @returns True if the error is due to rate limiting
   */
  public isRateLimit(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.TOO_MANY_REQUESTS.statusCode;
  }

  /**
   * Checks if the error is due to an unsupported system contract operation
   *
   * @returns True if the operation is not supported for system contracts
   */
  public isNotSupportedSystemContractOperaton(): boolean {
    return this.message === 'Precompile not supported';
  }

  /**
   * Checks if the error is a FAIL_INVALID error
   *
   * @returns True if the error is FAIL_INVALID
   */
  public isFailInvalid(): boolean {
    return this.message === 'FAIL_INVALID';
  }

  /**
   * Checks if the error is an INVALID_TRANSACTION error
   *
   * @returns True if the transaction is invalid
   */
  public isInvalidTransaction(): boolean {
    return this.message === 'INVALID_TRANSACTION';
  }

  /**
   * Checks if the error is an internal server error
   *
   * @returns True if the error is an internal server error
   */
  public isInternalServerError(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.INTERNAL_SERVER_ERROR.statusCode;
  }

  /**
   * Checks if the error is due to an unsupported operation
   *
   * @returns True if the operation is not supported
   */
  public isNotSupported(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.NOT_SUPPORTED.statusCode;
  }

  /**
   * Checks if the error is a bad gateway error
   *
   * @returns True if the error is a bad gateway error
   */
  public isBadGateway(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.BAD_GATEWAY.statusCode;
  }

  /**
   * Checks if the error is a service unavailable error
   *
   * @returns True if the service is unavailable
   */
  public isServiceUnavailable(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.SERVICE_UNAVAILABLE.statusCode;
  }

  /**
   * Checks if the error is due to a timeout
   *
   * @returns True if the error is due to a timeout
   */
  public isTimeout(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.ECONNABORTED.statusCode;
  }
}
