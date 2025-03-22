// SPDX-License-Identifier: Apache-2.0

import { decodeErrorMessage } from '../../formatters';
import constants from '../../lib/constants';

export class JsonRpcError {
  public code: number;
  public message: string;
  public data?: string;

  constructor(args: { code: number; message: string; data?: string }, requestId?: string) {
    this.code = args.code;
    this.message = requestId ? `[${constants.REQUEST_ID_STRING}${requestId}] ` + args.message : args.message;
    this.data = args.data;
  }
}

export const predefined = {
  CONTRACT_REVERT: (errorMessage?: string, data: string = '') => {
    let message: string;
    if (errorMessage?.length) {
      message = `execution reverted: ${decodeErrorMessage(errorMessage)}`;
    } else {
      const decodedData = decodeErrorMessage(data);
      message = decodedData.length ? `execution reverted: ${decodedData}` : 'execution reverted';
    }
    return new JsonRpcError({
      code: 3,
      message,
      data,
    });
  },
  DEPENDENT_SERVICE_IMMATURE_RECORDS: new JsonRpcError({
    code: -32015,
    message: 'Dependent service returned immature records',
  }),
  GAS_LIMIT_TOO_HIGH: (gasLimit, maxGas) =>
    new JsonRpcError({
      code: -32005,
      message: `Transaction gas limit '${gasLimit}' exceeds max gas per sec limit '${maxGas}'`,
    }),
  GAS_LIMIT_TOO_LOW: (gasLimit, requiredGas) =>
    new JsonRpcError({
      code: -32003,
      message: `Transaction gas limit provided '${gasLimit}' is insufficient of intrinsic gas required '${requiredGas}'`,
    }),
  GAS_PRICE_TOO_LOW: (gasPrice, minGasPrice) =>
    new JsonRpcError({
      code: -32009,
      message: `Gas price '${gasPrice}' is below configured minimum gas price '${minGasPrice}'`,
    }),
  HBAR_RATE_LIMIT_EXCEEDED: new JsonRpcError({
    code: -32606,
    message: 'HBAR Rate limit exceeded',
  }),
  HBAR_RATE_LIMIT_PREEMPTIVE_EXCEEDED: new JsonRpcError({
    code: -32606,
    message: 'The HBAR rate limit was preemptively exceeded due to an excessively large callData size.',
  }),
  INSUFFICIENT_ACCOUNT_BALANCE: new JsonRpcError({
    code: -32000,
    message: 'Insufficient funds for transfer',
  }),
  INTERNAL_ERROR: (message = '') =>
    new JsonRpcError({
      code: -32603,
      message: message === '' || undefined ? 'Unknown error invoking RPC' : `Error invoking RPC: ${message}`,
    }),
  INVALID_PARAMETER: (index: number | string, message: string) =>
    new JsonRpcError({
      code: -32602,
      message: `Invalid parameter ${index}: ${message}`,
    }),
  INVALID_PARAMETERS: new JsonRpcError({
    code: -32602,
    message: 'Invalid params',
  }),
  INVALID_REQUEST: new JsonRpcError({
    code: -32600,
    message: 'Invalid request',
  }),
  IP_RATE_LIMIT_EXCEEDED: (methodName: string) =>
    new JsonRpcError({
      code: -32605,
      message: `IP Rate limit exceeded on ${methodName}`,
    }),
  MISSING_FROM_BLOCK_PARAM: new JsonRpcError({
    code: -32011,
    message: 'Provided toBlock parameter without specifying fromBlock',
  }),
  MISSING_REQUIRED_PARAMETER: (index: number | string) =>
    new JsonRpcError({
      code: -32602,
      message: `Missing value for required parameter ${index}`,
    }),
  NONCE_TOO_LOW: (nonce, currentNonce) =>
    new JsonRpcError({
      code: 32001,
      message: `Nonce too low. Provided nonce: ${nonce}, current nonce: ${currentNonce}`,
    }),
  NONCE_TOO_HIGH: (nonce, currentNonce) =>
    new JsonRpcError({
      code: 32002,
      message: `Nonce too high. Provided nonce: ${nonce}, current nonce: ${currentNonce}`,
    }),
  NO_MINING_WORK: new JsonRpcError({
    code: -32000,
    message: 'No mining work available yet',
  }),
  PARSE_ERROR: new JsonRpcError({
    code: -32700,
    message: 'Unable to parse JSON',
  }),
  RANGE_TOO_LARGE: (blockRange: number) =>
    new JsonRpcError({
      code: -32000,
      message: `Exceeded maximum block range: ${blockRange}`,
    }),
  TIMESTAMP_RANGE_TOO_LARGE: (fromBlock: string, fromTimestamp: number, toBlock: string, toTimestamp: number) =>
    new JsonRpcError({
      code: -32004,
      message: `The provided fromBlock and toBlock contain timestamps that exceed the maximum allowed duration of 7 days (604800 seconds): fromBlock: ${fromBlock} (${fromTimestamp}), toBlock: ${toBlock} (${toTimestamp})`,
    }),
  REQUEST_BEYOND_HEAD_BLOCK: (requested: number, latest: number) =>
    new JsonRpcError({
      code: -32000,
      message: `Request beyond head block: requested ${requested}, head ${latest}`,
    }),
  REQUEST_TIMEOUT: new JsonRpcError({
    code: -32010,
    message: 'Request timeout. Please try again.',
  }),
  RESOURCE_NOT_FOUND: (message = '') =>
    new JsonRpcError({
      code: -32001,
      message: `Requested resource not found. ${message}`,
    }),
  UNKNOWN_HISTORICAL_BALANCE: new JsonRpcError({
    code: -32007,
    message: 'Historical balance data is available only after 15 minutes.',
  }),
  UNSUPPORTED_CHAIN_ID: (requested: string | number, current: string | number) =>
    new JsonRpcError({
      code: -32000,
      message: `ChainId (${requested}) not supported. The correct chainId is ${current}`,
    }),
  UNSUPPORTED_METHOD: new JsonRpcError({
    code: -32601,
    message: 'Unsupported JSON-RPC method',
  }),
  NOT_YET_IMPLEMENTED: new JsonRpcError({
    code: -32601,
    message: 'Not yet implemented',
  }),
  UNSUPPORTED_TRANSACTION_TYPE: new JsonRpcError({
    code: -32611,
    message: 'Unsupported transaction type',
  }),
  VALUE_TOO_LOW: new JsonRpcError({
    code: -32602,
    message: "Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar",
  }),
  INVALID_CONTRACT_ADDRESS: (address) => {
    let message = `Invalid Contract Address: ${address}.`;
    if (address && address.length) {
      message = `${message} Expected length of 42 chars but was ${address.length}.`;
    }

    return new JsonRpcError({
      code: -32012,
      message: message,
    });
  },
  NON_EXISTING_CONTRACT: (address) => {
    let message = `Non Existing Contract Address: ${address}.`;
    if (address && address.length) {
      message = `${message} Expected a Contract or Token Address.`;
    }

    return new JsonRpcError({
      code: -32013,
      message: message,
    });
  },
  NON_EXISTING_ACCOUNT: (address) => {
    let message = `Non Existing Account Address: ${address}.`;
    if (address && address.length) {
      message = `${message} Expected an Account Address.`;
    }

    return new JsonRpcError({
      code: -32014,
      message: message,
    });
  },
  COULD_NOT_ESTIMATE_GAS_PRICE: new JsonRpcError({
    code: -32604,
    message: 'Error encountered estimating the gas price',
  }),
  COULD_NOT_RETRIEVE_LATEST_BLOCK: new JsonRpcError({
    code: -32607,
    message: 'Error encountered retrieving latest block',
  }),
  MAX_SUBSCRIPTIONS: new JsonRpcError({
    code: -32608,
    message: 'Exceeded maximum allowed subscriptions',
  }),
  UNSUPPORTED_HISTORICAL_EXECUTION: (blockId: string) =>
    new JsonRpcError({
      code: -32609,
      message: `Unsupported historical block identifier encountered: ${blockId}`,
    }),
  UNSUPPORTED_OPERATION: (message: string) =>
    new JsonRpcError({
      code: -32610,
      message: `Unsupported operation. ${message}`,
    }),
  PAGINATION_MAX: (count: number) =>
    new JsonRpcError({
      code: -32011,
      message: `Exceeded maximum mirror node pagination count: ${count}`,
    }),
  MAX_BLOCK_SIZE: (count: number) =>
    new JsonRpcError({
      code: -32000,
      message: `Exceeded max transactions that can be returned in a block: ${count}`,
    }),
  UNKNOWN_BLOCK: (msg?: string | null) =>
    new JsonRpcError({
      code: -39012,
      message: msg || 'Unknown block',
    }),
  INVALID_BLOCK_RANGE: new JsonRpcError({
    code: -39013,
    message: 'Invalid block range',
  }),
  RECEIVER_SIGNATURE_ENABLED: new JsonRpcError({
    code: -32000,
    message: "Operation is not supported when receiver's signature is enabled.",
  }),
  FILTER_NOT_FOUND: new JsonRpcError({
    code: -32001,
    message: 'Filter not found',
  }),
  TRANSACTION_SIZE_TOO_BIG: (actualSize: string, expectedSize: string) =>
    new JsonRpcError({
      code: -32201,
      message: `Oversized data: transaction size ${actualSize}, transaction limit ${expectedSize}`,
    }),
  BATCH_REQUESTS_DISABLED: new JsonRpcError({
    code: -32202,
    message: 'Batch requests are disabled',
  }),
  BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED: (amount: number, max: number) =>
    new JsonRpcError({
      code: -32203,
      message: `Batch request amount ${amount} exceeds max ${max}`,
    }),
  BATCH_REQUESTS_METHOD_NOT_PERMITTED: (method: string) =>
    new JsonRpcError({
      code: -32007,
      message: `Method ${method} is not permitted as part of batch requests`,
    }),
  WS_BATCH_REQUESTS_DISABLED: new JsonRpcError({
    code: -32205,
    message: 'WS batch requests are disabled',
  }),
  WS_BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED: (amount: number, max: number) =>
    new JsonRpcError({
      code: -32206,
      message: `Batch request amount ${amount} exceeds max ${max}`,
    }),
  INVALID_ARGUMENTS: (message: string) =>
    new JsonRpcError({
      code: -32000,
      message: `Invalid arguments: ${message}`,
    }),
};
