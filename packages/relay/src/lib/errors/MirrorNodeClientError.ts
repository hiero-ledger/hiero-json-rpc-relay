// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hashgraph/sdk';

export class MirrorNodeClientError extends Error {
  public statusCode: number;
  public data?: string;
  public detail?: string;
  private children: { message: string; detail?: string; data?: string }[];

  static ErrorCodes = {
    ECONNABORTED: 504,
    NOT_SUPPORTED: 501,
  };

  static statusCodes = {
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    NO_CONTENT: 204,
  };

  static messages = {
    INVALID_HEX: 'data field invalid hexadecimal string',
    CONTRACT_REVERT_EXECUTED: Status.ContractRevertExecuted.toString(),
  };

  constructor(error: any, statusCode: number) {
    // mirror node web3 module sends errors in this format, this is why we need a check to distinguish
    if (error.response?.data?._status?.messages?.length) {
      const [msg, ...children] = error.response.data._status.messages;
      const { message, detail, data } = msg;
      super(message);

      this.detail = detail;
      this.data = data;
      this.children = children || [];
    } else {
      super(error.message);

      this.children = [];
    }

    this.statusCode = statusCode;
    Object.setPrototypeOf(this, MirrorNodeClientError.prototype);
  }

  get revertReason(): string {
    const reasons = this.children
      .map((child) => child.detail || child.message)
      .filter(Boolean)
      .join(', ');
    return `${reasons}, ${this.detail || this.message}`;
  }

  public isTimeout(): boolean {
    return this.statusCode === MirrorNodeClientError.ErrorCodes.ECONNABORTED;
  }

  public isContractRevert() {
    return this.message === MirrorNodeClientError.messages.CONTRACT_REVERT_EXECUTED;
  }

  public isNotFound(): boolean {
    return this.statusCode === MirrorNodeClientError.statusCodes.NOT_FOUND;
  }

  public isNotSupported(): boolean {
    return this.statusCode === MirrorNodeClientError.ErrorCodes.NOT_SUPPORTED;
  }

  public isEmpty(): boolean {
    return this.statusCode === MirrorNodeClientError.statusCodes.NO_CONTENT;
  }

  public isRateLimit(): boolean {
    return this.statusCode === MirrorNodeClientError.statusCodes.TOO_MANY_REQUESTS;
  }

  public isNotSupportedSystemContractOperaton(): boolean {
    return this.message === 'Precompile not supported';
  }

  isFailInvalid() {
    return this.message === 'FAIL_INVALID';
  }

  isInvalidTransaction() {
    return this.message === 'INVALID_TRANSACTION';
  }
}
