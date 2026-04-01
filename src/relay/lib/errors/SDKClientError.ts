// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hashgraph/sdk';

export class SDKClientError extends Error {
  public status: Status = Status.Unknown;
  public nodeAccountId: string | undefined;
  private failedTransactionId: string | undefined;

  constructor(e: any, message?: string, transactionId?: string, nodeId?: string | undefined) {
    super(e?.status?._code ? e.message : message);

    if (e?.status?._code) {
      this.status = e.status;
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
    return this.statusCode == Status.ContractRevertExecuted._code;
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
