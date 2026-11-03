// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { WsTestHelper } from '../../ws-server/helper';

export interface CallRawOptions {
  /** Override the apparent source IP via X-Forwarded-For (requires app.proxy = true on the server). */
  ip?: string;
}

export interface RpcRawResponse {
  id?: number;
  jsonrpc?: string;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; name?: string; data?: unknown };
  status?: number;
}

/**
 * Unified transport abstraction for protocol-parameterized acceptance tests.
 * Implementations normalize both HTTP and WebSocket transports to the same
 * interface: returns the RPC result directly, throws on error.
 */
export interface RpcProtocolClient {
  readonly label: string;
  call(method: string, params: unknown[]): Promise<unknown>;
  callRaw(method: string, params: unknown, options?: CallRawOptions): Promise<RpcRawResponse>;
}

type TestGlobal = typeof globalThis & {
  relay: {
    call(method: string, params: unknown[]): Promise<unknown>;
    provider: { _getConnection(): { url: string } };
  };
};

class HttpProtocolClient implements RpcProtocolClient {
  readonly label = 'HTTP';

  async call(method: string, params: unknown[]): Promise<unknown> {
    return (global as TestGlobal).relay.call(method, params);
  }

  async callRaw(method: string, params: unknown, options?: CallRawOptions): Promise<RpcRawResponse> {
    const url: string = (global as TestGlobal).relay.provider._getConnection().url;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options?.ip) {
      headers['X-Forwarded-For'] = options.ip;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    });
    const body = (await resp.json()) as RpcRawResponse;
    return { ...body, status: resp.status };
  }
}

class WsProtocolClient implements RpcProtocolClient {
  readonly label = 'WebSocket';

  async call(method: string, params: unknown[]): Promise<unknown> {
    const response = await this.callRaw(method, params);
    if (response.error) {
      throw Object.assign(new Error(response.error.message), { code: response.error.code });
    }
    return response.result;
  }

  async callRaw(method: string, params: unknown, options?: CallRawOptions): Promise<RpcRawResponse> {
    if (options?.ip) {
      return WsTestHelper.sendRequestWithIp(method, Array.isArray(params) ? params : [], options.ip);
    }
    return WsTestHelper.sendRequestToStandardWebSocket(method, params);
  }
}

export const ALL_PROTOCOL_CLIENTS: RpcProtocolClient[] = [new HttpProtocolClient(), new WsProtocolClient()];

// Every error message carries a per-request ID, so it never matches across two requests.
const REQUEST_ID_PREFIX = /^\[Request ID: [^\]]+\] /;

const toComparable = ({ result, error }: RpcRawResponse): Pick<RpcRawResponse, 'result' | 'error'> =>
  error
    ? { error: { code: error.code, message: error.message.replace(REQUEST_ID_PREFIX, ''), data: error.data } }
    : { result };

/**
 * Sends the same request over HTTP and WebSocket and asserts both return the same result or error.
 *
 * @param method - JSON-RPC method name.
 * @param params - JSON-RPC params, sent unchanged on both transports.
 * @param options - Optional raw-call options applied to both transports.
 */
export async function assertSameJsonRpcResultAcrossTransports(
  method: string,
  params: unknown,
  options?: CallRawOptions,
): Promise<void> {
  const [http, ws] = (
    await Promise.all(ALL_PROTOCOL_CLIENTS.map((client) => client.callRaw(method, params, options)))
  ).map(toComparable);
  expect(ws, `${method} returned a different response over WebSocket than over HTTP`).to.deep.equal(http);
}
