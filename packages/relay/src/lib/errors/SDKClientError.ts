// SPDX-License-Identifier: Apache-2.0

/**
 * Well-known Hedera SDK status codes used for error classification.
 * These values match the protobuf ResponseCodeEnum defined in the Hedera SDK.
 * Using numeric literals avoids loading the full SDK barrel (~20MB RSS) at module evaluation time.
 */
const HederaStatusCode = {
  UNKNOWN: 21,
  SUCCESS: 22,
  CONTRACT_REVERT_EXECUTED: 33,
  INVALID_TRANSACTION_ID: 17,
} as const;

export class SDKClientError extends Error {
  /**
   * The raw status object from the SDK error response.
   * Contains `_code` (numeric) and `toString()` for the status name.
   */
  public status: { _code: number; toString(): string };
  public nodeAccountId: string | undefined;
  private failedTransactionId: string | undefined;

  constructor(e: any, message?: string, transactionId?: string, nodeId?: string | undefined) {
    super(e?.status?._code ? e.message : message);

    if (e?.status?._code) {
      this.status = e.status;
    } else {
      this.status = { _code: HederaStatusCode.UNKNOWN, toString: () => 'UNKNOWN' };
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
    return this.statusCode === HederaStatusCode.CONTRACT_REVERT_EXECUTED;
  }

  public isTimeoutExceeded(): boolean {
    return this.statusCode === HederaStatusCode.UNKNOWN && this.message?.includes('timeout exceeded');
  }

  public isConnectionDropped(): boolean {
    return this.statusCode === HederaStatusCode.UNKNOWN && this.message?.includes('Connection dropped');
  }

  public isGrpcTimeout(): boolean {
    // The SDK uses the same code for Grpc Timeout as INVALID_TRANSACTION_ID
    return this.statusCode === HederaStatusCode.INVALID_TRANSACTION_ID;
  }
}
