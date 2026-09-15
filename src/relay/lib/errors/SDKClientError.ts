// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hiero-ledger/sdk';

export class SDKClientError extends Error {
  public status: Status = Status.Unknown;
  public nodeAccountId: string | undefined;
  private failedTransactionId: string | undefined;

  constructor(e: unknown, message?: string, transactionId?: string, nodeId?: string | undefined) {
    const error = e as { message?: string; status?: Status } | undefined;
    super(error?.status?._code ? error.message : message);

    if (error?.status?._code) {
      this.status = error.status;
    }
    this.failedTransactionId = transactionId || '';
    this.nodeAccountId = nodeId;
    Object.setPrototypeOf(this, SDKClientError.prototype);
  }

  get statusCode(): number {
    return this.status._code;
  }

  get transactionId(): string | undefined {
    return this.failedTransactionId;
  }

  public isContractRevertExecuted(): boolean {
    return this.statusCode === Status.ContractRevertExecuted._code;
  }

  public isTimeoutExceeded(): boolean {
    return this.statusCode === Status.Unknown._code && this.message?.includes('timeout exceeded');
  }

  public isConnectionDropped(): boolean {
    return this.statusCode === Status.Unknown._code && this.message?.includes('Connection dropped');
  }

  public isGrpcTimeout(): boolean {
    // The SDK uses the same code for Grpc Timeout as INVALID_TRANSACTION_ID
    return this.statusCode === Status.InvalidTransactionId._code;
  }
}
