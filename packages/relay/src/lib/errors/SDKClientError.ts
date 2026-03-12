// SPDX-License-Identifier: Apache-2.0

/**
 * Numeric status codes from Hedera protobuf `response_code.proto`.
 * Stable since HIP-26 — inlined to avoid loading the full `@hashgraph/sdk` barrel.
 */
const HederaStatusCode = {
  InvalidTransactionId: 17,
  Unknown: 21,
  Success: 22,
  ContractRevertExecuted: 33,
} as const;

export class SDKClientError extends Error {
  public statusCode: number = HederaStatusCode.Unknown;
  public nodeAccountId: string | undefined;
  private failedTransactionId: string | undefined;

  constructor(e: any, message?: string, transactionId?: string, nodeId?: string | undefined) {
    super(e?.status?._code ? e.message : message);

    if (e?.status?._code) {
      this.statusCode = e.status._code;
    }
    this.failedTransactionId = transactionId || '';
    this.nodeAccountId = nodeId;
    Object.setPrototypeOf(this, SDKClientError.prototype);
  }

  get status(): { _code: number; toString(): string } {
    return {
      _code: this.statusCode,
      toString: () => `Status code: ${this.statusCode}`,
    };
  }

  get transactionId(): string | undefined {
    return this.failedTransactionId;
  }

  public isContractRevertExecuted(): boolean {
    return this.statusCode == HederaStatusCode.ContractRevertExecuted;
  }

  public isTimeoutExceeded(): boolean {
    return this.statusCode === HederaStatusCode.Unknown && this.message?.includes('timeout exceeded');
  }

  public isConnectionDropped(): boolean {
    return this.statusCode === HederaStatusCode.Unknown && this.message?.includes('Connection dropped');
  }

  public isGrpcTimeout(): boolean {
    // The SDK uses the same code for Grpc Timeout as INVALID_TRANSACTION_ID
    return this.statusCode === HederaStatusCode.InvalidTransactionId;
  }
}
