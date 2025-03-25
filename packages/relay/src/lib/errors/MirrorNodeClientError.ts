// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hashgraph/sdk';

export class MirrorNodeClientError extends Error {
  public statusCode: number;
  public data?: string;
  public detail?: string;

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

  public isContractReverted(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.CONTRACT_REVERT_EXECUTED.statusCode;
  }

  public isContractRevertOpcodeExecuted() {
    return this.message === MirrorNodeClientError.messages.CONTRACT_REVERT_EXECUTED;
  }

  public isNotFound(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.NOT_FOUND.statusCode;
  }

  public isEmpty(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.NO_CONTENT.statusCode;
  }

  public isRateLimit(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.TOO_MANY_REQUESTS.statusCode;
  }

  public isNotSupportedSystemContractOperaton(): boolean {
    return this.message === 'Precompile not supported';
  }

  public isFailInvalid() {
    return this.message === 'FAIL_INVALID';
  }

  public isInvalidTransaction() {
    return this.message === 'INVALID_TRANSACTION';
  }

  public isInternalServerError() {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.INTERNAL_SERVER_ERROR.statusCode;
  }

  public isNotSupported(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.NOT_SUPPORTED.statusCode;
  }

  public isBadGateway() {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.BAD_GATEWAY.statusCode;
  }

  public isServiceUnavailable() {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.SERVICE_UNAVAILABLE.statusCode;
  }

  public isTimeout(): boolean {
    return this.statusCode === MirrorNodeClientError.HttpStatusResponses.ECONNABORTED.statusCode;
  }
}
