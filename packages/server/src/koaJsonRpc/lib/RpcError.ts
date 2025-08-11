// SPDX-License-Identifier: Apache-2.0

export interface IJsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * Standard JSON-RPC 2.0 error codes and messages.
 *
 * See _5.1 Error object_ https://www.jsonrpc.org/specification#error_object.
 */
export const spec = {
  ParseError: { code: -32700, message: 'Parse error' },
  InvalidRequest: { code: -32600, message: 'Invalid Request' },
  MethodNotFound: (methodName: string) => ({ code: -32601, message: `Method ${methodName} not found` }),

  /**
   * @param err The error object that caused this `InternalError`.
   */
  InternalError: (err: unknown) => ({
    code: -32603,
    message: err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Internal error',
  }),

  IPRateLimitExceeded: (methodName: string) => ({ code: -32605, message: `IP Rate limit exceeded on ${methodName}` }),
} satisfies Record<string, IJsonRpcError | ((...args: any[]) => IJsonRpcError)>;
