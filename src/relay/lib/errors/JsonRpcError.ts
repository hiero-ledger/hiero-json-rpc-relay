// SPDX-License-Identifier: Apache-2.0

import { decodeErrorMessage } from '../../formatters';
import { isClientHederaStatus, isClientHttpStatus } from './errorClassification';

export class JsonRpcError extends Error {
  public code: number;
  public data?: unknown;

  /**
   * `true` when the client caused the error (invalid params, unknown method, revert, …), so it is logged
   * at `DEBUG` instead of `ERROR`. Errors that can have either cause stay `false`.
   */
  public readonly isClientError: boolean;

  /**
   * @param args.code - The JSON-RPC error code.
   * @param args.message - The message returned to the client.
   * @param args.data - Extra data returned to the client.
   * @param args.clientError - Whether the client caused the error, see {@link isClientError}.
   * @param args.cause - The error this one wraps; logged with its stack, never returned to the client.
   */
  constructor(args: { code: number; message: string; data?: unknown; clientError?: boolean; cause?: unknown }) {
    super(args.message, args.cause === undefined ? undefined : { cause: args.cause });
    this.code = args.code;
    this.data = args.data;
    this.isClientError = args.clientError ?? false;
  }

  /**
   * Returns this error flagged as a client error, for throw sites that know the client caused an error
   * that can also have a server cause. Predefined errors are shared, so this returns a copy.
   *
   * @returns This error when it is already a client error, otherwise a flagged copy.
   */
  public asClientError(): JsonRpcError {
    if (this.isClientError) {
      return this;
    }
    return new JsonRpcError({
      code: this.code,
      message: this.message,
      data: this.data,
      clientError: true,
      cause: this.cause,
    });
  }

  public toJSON(): { code: number; data: unknown; message: string; name: string; clientError?: true } {
    return {
      code: this.code,
      data: this.data,
      message: this.message,
      name: JsonRpcError.name,
      ...(this.isClientError && { clientError: true as const }),
    };
  }
}

export const predefined = {
  CONTENT_TOO_LARGE: new JsonRpcError({
    code: -32000,
    clientError: true,
    message: `The request payload exceeded the maximum size limit. Use a smaller block range.`,
  }),
  CONTRACT_REVERT: (errorMessage?: string, data: string = ''): JsonRpcError => {
    let message: string;
    if (errorMessage?.length) {
      message = `execution reverted: ${decodeErrorMessage(errorMessage)}`;
    } else {
      const decodedData = decodeErrorMessage(data);
      message = decodedData.length ? `execution reverted: ${decodedData}` : 'execution reverted';
    }
    return new JsonRpcError({
      code: 3,
      clientError: true,
      message,
      data,
    });
  },
  DEPENDENT_SERVICE_IMMATURE_RECORDS: new JsonRpcError({
    code: -32015,
    message: 'Dependent service returned immature records',
  }),
  GAS_LIMIT_TOO_HIGH: (gasLimit: string | number | bigint, maxGas: string | number | bigint): JsonRpcError =>
    new JsonRpcError({
      code: -32005,
      clientError: true,
      message: `Transaction gas limit '${gasLimit}' exceeds max gas per sec limit '${maxGas}'`,
    }),
  GAS_LIMIT_TOO_LOW: (gasLimit: string | number | bigint, requiredGas: string | number | bigint): JsonRpcError =>
    new JsonRpcError({
      code: -32003,
      clientError: true,
      message: `Transaction gas limit provided '${gasLimit}' is insufficient of intrinsic gas required '${requiredGas}'`,
    }),
  GAS_PRICE_TOO_LOW: (gasPrice: string | number | bigint, minGasPrice: string | number | bigint): JsonRpcError =>
    new JsonRpcError({
      code: -32009,
      clientError: true,
      message: `Gas price '${gasPrice}' is below configured minimum gas price '${minGasPrice}'`,
    }),
  HBAR_RATE_LIMIT_EXCEEDED: new JsonRpcError({
    code: -32606,
    message: 'HBAR Rate limit exceeded',
  }),
  HBAR_RATE_LIMIT_PREEMPTIVE_EXCEEDED: new JsonRpcError({
    code: -32606,
    clientError: true,
    message: 'The HBAR rate limit was preemptively exceeded due to an excessively large callData size.',
  }),
  INSUFFICIENT_ACCOUNT_BALANCE: new JsonRpcError({
    code: -32000,
    clientError: true,
    message: 'Insufficient funds for transfer',
  }),
  /**
   * @param message - Appended to the message returned to the client.
   * @param cause - The unexpected error being wrapped, logged with its stack.
   */
  INTERNAL_ERROR: (message = '', cause?: unknown): JsonRpcError =>
    new JsonRpcError({
      code: -32603,
      message: message === '' || undefined ? 'Unknown error invoking RPC' : `Error invoking RPC: ${message}`,
      cause,
    }),
  INVALID_PARAMETER: (index: number | string, message: string): JsonRpcError =>
    new JsonRpcError({
      code: -32602,
      clientError: true,
      message: `Invalid parameter ${index}: ${message}`,
    }),
  INVALID_PARAMETERS: new JsonRpcError({
    code: -32602,
    clientError: true,
    message: 'Invalid params',
  }),
  INVALID_REQUEST: new JsonRpcError({
    code: -32600,
    clientError: true,
    message: 'Invalid request',
  }),
  IP_RATE_LIMIT_EXCEEDED: (methodName: string): JsonRpcError =>
    new JsonRpcError({
      code: -32605,
      clientError: true,
      message: `IP Rate limit exceeded on ${methodName}`,
    }),
  MISSING_FROM_BLOCK_PARAM: new JsonRpcError({
    code: -32011,
    clientError: true,
    message: 'Provided toBlock parameter without specifying fromBlock',
  }),
  MISSING_REQUIRED_PARAMETER: (index: number | string): JsonRpcError =>
    new JsonRpcError({
      code: -32602,
      clientError: true,
      message: `Missing value for required parameter ${index}`,
    }),
  NONCE_TOO_LOW: (nonce: number, currentNonce: number): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      clientError: true,
      message: `Nonce too low. Provided nonce: ${nonce}, current nonce: ${currentNonce}`,
    }),
  NONCE_TOO_HIGH: (nonce: number, currentNonce: number): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      clientError: true,
      message: `Nonce too high. Provided nonce: ${nonce}, current nonce: ${currentNonce}`,
    }),
  NO_MINING_WORK: new JsonRpcError({
    code: -32000,
    clientError: true,
    message: 'No mining work available yet',
  }),
  PARSE_ERROR: new JsonRpcError({
    code: -32700,
    clientError: true,
    message: 'Unable to parse JSON',
  }),
  RANGE_TOO_LARGE: (blockRange: number): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      clientError: true,
      message: `Exceeded maximum block range: ${blockRange}`,
    }),
  TIMESTAMP_RANGE_TOO_LARGE: (
    fromBlock: string,
    fromTimestamp: string | number,
    toBlock: string,
    toTimestamp: string | number,
  ): JsonRpcError =>
    new JsonRpcError({
      code: -32004,
      clientError: true,
      message: `The provided fromBlock and toBlock contain timestamps that exceed the maximum allowed duration of 7 days (604800 seconds): fromBlock: ${fromBlock} (${fromTimestamp}), toBlock: ${toBlock} (${toTimestamp})`,
    }),
  REQUEST_BEYOND_HEAD_BLOCK: (requested: number, latest: number): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      clientError: true,
      message: `Request beyond head block: requested ${requested}, head ${latest}`,
    }),
  GET_LOGS_RELAY_BUSY: (): JsonRpcError =>
    new JsonRpcError({
      code: -32005,
      message: 'eth_getLogs memory limit reached on the relay, try again later',
    }),
  REQUEST_TIMEOUT: new JsonRpcError({
    code: -32010,
    message: 'Request timeout. Please try again.',
  }),
  RESOURCE_NOT_FOUND: (message = ''): JsonRpcError =>
    new JsonRpcError({
      code: -32001,
      message: `Requested resource not found. ${message}`,
    }),
  UNKNOWN_HISTORICAL_BALANCE: new JsonRpcError({
    code: -32007,
    clientError: true,
    message: 'Historical balance data is available only after 15 minutes.',
  }),
  UNSUPPORTED_CHAIN_ID: (requested: string | number, current: string | number): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      clientError: true,
      message: `ChainId (${requested}) not supported. The correct chainId is ${current}`,
    }),
  UNSUPPORTED_METHOD: new JsonRpcError({
    code: -32601,
    clientError: true,
    message: 'Unsupported JSON-RPC method',
  }),
  METHOD_NOT_FOUND: (methodName: string): JsonRpcError =>
    new JsonRpcError({
      code: -32601,
      clientError: true,
      message: `Method ${methodName} not found`,
    }),
  NOT_YET_IMPLEMENTED: new JsonRpcError({
    code: -32601,
    clientError: true,
    message: 'Not yet implemented',
  }),
  UNSUPPORTED_TRANSACTION_TYPE_3: new JsonRpcError({
    code: -32611,
    clientError: true,
    message: `Unsupported transaction type: txType=3`,
  }),
  UNSUPPORTED_TRANSACTION_TYPE_4: new JsonRpcError({
    code: -32611,
    clientError: true,
    message: `Unsupported transaction type: txType=4`,
  }),
  VALUE_TOO_LOW: new JsonRpcError({
    code: -32602,
    clientError: true,
    message: "Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar",
  }),
  INVALID_CONTRACT_ADDRESS: (address: string | null | undefined): JsonRpcError => {
    let message = `Invalid Contract Address: ${address}.`;
    if (address && address.length) {
      message = `${message} Expected length of 42 chars but was ${address.length}.`;
    }

    return new JsonRpcError({
      code: -32012,
      clientError: true,
      message: message,
    });
  },
  NON_EXISTING_CONTRACT: (address: string | null | undefined): JsonRpcError => {
    let message = `Non Existing Contract Address: ${address}.`;
    if (address && address.length) {
      message = `${message} Expected a Contract or Token Address.`;
    }

    return new JsonRpcError({
      code: -32013,
      clientError: true,
      message: message,
    });
  },
  NON_EXISTING_ACCOUNT: (address: string | null | undefined): JsonRpcError => {
    let message = `Non Existing Account Address: ${address}.`;
    if (address && address.length) {
      message = `${message} Expected an Account Address.`;
    }

    return new JsonRpcError({
      code: -32014,
      clientError: true,
      message: message,
    });
  },
  /**
   * @param errMessage - Appended to the message returned to the client.
   * @param cause - The error being wrapped, logged with its stack.
   */
  COULD_NOT_SIMULATE_TRANSACTION: (errMessage: string, cause?: unknown): JsonRpcError => {
    return new JsonRpcError({
      code: -32000,
      message: `Error occurred during transaction simulation: ${errMessage}`,
      cause,
    });
  },
  COULD_NOT_RETRIEVE_LATEST_BLOCK: new JsonRpcError({
    code: -32607,
    message: 'Error encountered retrieving latest block',
  }),
  MAX_SUBSCRIPTIONS: new JsonRpcError({
    code: -32608,
    clientError: true,
    message: 'Exceeded maximum allowed subscriptions',
  }),
  UNSUPPORTED_HISTORICAL_EXECUTION: (blockId: string): JsonRpcError =>
    new JsonRpcError({
      code: -32609,
      clientError: true,
      message: `Unsupported historical block identifier encountered: ${blockId}`,
    }),
  UNSUPPORTED_OPERATION: (message: string): JsonRpcError =>
    new JsonRpcError({
      code: -32610,
      clientError: true,
      message: `Unsupported operation. ${message}`,
    }),
  LOGS_RESPONSE_SIZE_EXCEEDED: (maxBytes: number): JsonRpcError =>
    new JsonRpcError({
      code: -32005,
      clientError: true,
      message: `Query returned more than ${maxBytes} bytes of logs. Narrow the block range or filter by address or topics`,
    }),
  MIRROR_NODE_RESPONSE_SIZE_EXCEEDED: (maxBytes: number): JsonRpcError =>
    new JsonRpcError({
      code: -32005,
      clientError: true,
      message: `Mirror node response exceeds the maximum size of ${maxBytes} bytes. Narrow the block range or filter by address or topics`,
    }),
  PAGINATION_MAX: (count: number): JsonRpcError =>
    new JsonRpcError({
      code: -32011,
      clientError: true,
      message: `Exceeded maximum mirror node pagination count: ${count}`,
    }),
  MAX_BLOCK_SIZE: (count: number): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      clientError: true,
      message: `Exceeded max transactions that can be returned in a block: ${count}`,
    }),
  /**
   * A client error when the Mirror Node rejected the request with a 4xx other than 429.
   *
   * @param errCode - The Mirror Node HTTP status (or the code a timeout or connection error is mapped to).
   * @param errMessage - The Mirror Node error message.
   * @param cause - The Mirror Node error being wrapped, logged with its stack.
   */
  MIRROR_NODE_UPSTREAM_FAIL: (errCode: number, errMessage: string, cause?: unknown): JsonRpcError => {
    return new JsonRpcError({
      code: -32020,
      message: `Mirror node upstream failure: statusCode=${errCode}, message=${errMessage}`,
      data: errCode, // Preserving the Mirror Node HTTP status for potential exposure/debugging
      clientError: isClientHttpStatus(errCode),
      cause,
    });
  },
  UNKNOWN_BLOCK: (msg?: string | null): JsonRpcError =>
    new JsonRpcError({
      code: -39012,
      clientError: true,
      message: msg || 'Unknown block',
    }),
  INVALID_BLOCK_RANGE: new JsonRpcError({
    code: -39013,
    clientError: true,
    message: 'Invalid block range',
  }),
  BLOCK_RANGE_BEYOND_HEAD: new JsonRpcError({
    code: -32602,
    clientError: true,
    message: 'block range extends beyond current head block',
  }),
  REVERSED_BLOCK_RANGE: new JsonRpcError({
    code: -32602,
    clientError: true,
    message: 'invalid block range params',
  }),
  RECEIVER_SIGNATURE_ENABLED: new JsonRpcError({
    code: -32000,
    clientError: true,
    message: "Operation is not supported when receiver's signature is enabled.",
  }),
  FILTER_NOT_FOUND: new JsonRpcError({
    code: -32001,
    message: 'Filter not found',
  }),
  TRANSACTION_SIZE_LIMIT_EXCEEDED: (actualSize: number, expectedSize: number): JsonRpcError =>
    new JsonRpcError({
      code: -32201,
      clientError: true,
      message: `Oversized data: transaction size ${actualSize}, transaction limit ${expectedSize}`,
    }),
  CALL_DATA_SIZE_LIMIT_EXCEEDED: (actualSize: number, expectedSize: number): JsonRpcError =>
    new JsonRpcError({
      code: -32201,
      clientError: true,
      message: `Oversized data: call data size ${actualSize}, call data size limit ${expectedSize}`,
    }),
  INITCODE_SIZE_LIMIT_EXCEEDED: (actualSize: number, expectedSize: number): JsonRpcError =>
    new JsonRpcError({
      code: -32201,
      clientError: true,
      message: `Oversized data: initcode size ${actualSize}, initcode size limit ${expectedSize}`,
    }),
  BATCH_REQUESTS_DISABLED: new JsonRpcError({
    code: -32202,
    clientError: true,
    message: 'Batch requests are disabled',
  }),
  BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED: (amount: number, max: number): JsonRpcError =>
    new JsonRpcError({
      code: -32203,
      clientError: true,
      message: `Batch request amount ${amount} exceeds max ${max}`,
    }),
  BATCH_REQUESTS_ADDRESS_TOTAL_EXCEEDED: (total: number, max: number): JsonRpcError =>
    new JsonRpcError({
      code: -32204,
      clientError: true,
      message: `Batch request address total ${total} exceeds max ${max}`,
    }),
  WS_BATCH_REQUESTS_DISABLED: new JsonRpcError({
    code: -32205,
    clientError: true,
    message: 'WS batch requests are disabled',
  }),
  WS_BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED: (amount: number, max: number): JsonRpcError =>
    new JsonRpcError({
      code: -32206,
      clientError: true,
      message: `Batch request amount ${amount} exceeds max ${max}`,
    }),
  WS_SUBSCRIPTIONS_DISABLED: new JsonRpcError({
    code: -32207,
    clientError: true,
    message: 'WS Subscriptions are disabled',
  }),
  WS_BATCH_REQUESTS_ADDRESS_TOTAL_EXCEEDED: (total: number, max: number): JsonRpcError =>
    new JsonRpcError({
      code: -32208,
      clientError: true,
      message: `Batch request address total ${total} exceeds max ${max}`,
    }),
  INVALID_ARGUMENTS: (message: string): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      clientError: true,
      message: `Invalid arguments: ${message}`,
    }),
  /**
   * A client error when the Hedera status is one of `CLIENT_HEDERA_STATUSES`.
   *
   * @param statusName - The Hedera status name, e.g. `INVALID_SIGNATURE`.
   * @param statusCode - The Hedera status code.
   * @param message - The consensus node error message.
   * @param cause - The SDK error being wrapped, logged with its stack.
   */
  CONSENSUS_NODE_ERROR: (statusName: string, statusCode: number, message: string, cause?: unknown): JsonRpcError =>
    new JsonRpcError({
      code: -32000,
      message: `Consensus node error: ${statusName} (${statusCode}): ${message}`,
      clientError: isClientHederaStatus(statusName),
      cause,
    }),
  /** A client error when the Hedera status is one of `CLIENT_HEDERA_STATUSES`. */
  TRANSACTION_REJECTED: (status: string, errorMessage?: string): JsonRpcError =>
    new JsonRpcError({
      code: -32003,
      message: `Transaction rejected: ${status}${errorMessage ? ` - ${errorMessage}` : ''}`,
      clientError: isClientHederaStatus(status),
    }),
  /**
   * The single `-32003` shape every rejected-transaction path returns, so the traced-outcome fallback and
   * the Mirror-Node immature-record path cannot diverge in the `data` clients decode.
   * A client error when the Hedera status is one of `CLIENT_HEDERA_STATUSES` (e.g. `WRONG_NONCE` from the receipt).
   *
   * @param details.txHash - The offending transaction's keccak256 hash (lower-cased).
   * @param details.hederaStatus - The underlying Hedera status code (e.g. `WRONG_NONCE`), when known.
   * @param details.detail - Human-readable failure detail.
   * @param details.transactionId - The Hedera transaction id, when known.
   * @param details.provisional - True when the outcome is not final (the tx may still reach consensus).
   * @param details.message - Overrides the default `Transaction rejected: <status>` message.
   */
  TRANSACTION_REJECTED_DETAILED: (details: {
    txHash: string;
    hederaStatus?: string;
    detail?: string;
    transactionId?: string;
    provisional?: boolean;
    message?: string;
  }): JsonRpcError =>
    new JsonRpcError({
      code: -32003,
      message: details.message ?? `Transaction rejected: ${details.hederaStatus ?? details.detail ?? 'unknown reason'}`,
      clientError: isClientHederaStatus(details.hederaStatus),
      data: {
        txHash: details.txHash,
        detail: details.detail,
        hederaStatus: details.hederaStatus,
        ...(details.transactionId !== undefined && { transactionId: details.transactionId }),
        ...(details.provisional !== undefined && { provisional: details.provisional }),
      },
    }),
};
