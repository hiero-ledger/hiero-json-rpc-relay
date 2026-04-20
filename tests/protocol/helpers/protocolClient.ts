// SPDX-License-Identifier: Apache-2.0

import { WsTestHelper } from '../../ws-server/helper';

export interface CallRawOptions {
  /** Override the apparent source IP via X-Forwarded-For (requires app.proxy = true on the server). */
  ip?: string;
}

/**
 * Unified transport abstraction for protocol-parameterized acceptance tests.
 * Implementations normalize both HTTP and WebSocket transports to the same
 * interface: returns the RPC result directly, throws on error.
 */
export interface RpcProtocolClient {
  readonly label: string;
  call(method: string, params: unknown[]): Promise<unknown>;
  callRaw(
    method: string,
    params: unknown[],
    options?: CallRawOptions,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
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

  async callRaw(
    method: string,
    params: unknown[],
    options?: CallRawOptions,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
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
    return resp.json() as Promise<{ result?: unknown; error?: { code: number; message: string } }>;
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

  async callRaw(
    method: string,
    params: unknown[],
    options?: CallRawOptions,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    if (options?.ip) {
      return WsTestHelper.sendRequestWithIp(method, params, options.ip);
    }
    return WsTestHelper.sendRequestToStandardWebSocket(method, params);
  }
}

export const ALL_PROTOCOL_CLIENTS: RpcProtocolClient[] = [new HttpProtocolClient(), new WsProtocolClient()];
