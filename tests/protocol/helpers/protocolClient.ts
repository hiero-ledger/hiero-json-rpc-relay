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
  call(method: string, params: any[]): Promise<any>;
  callRaw(
    method: string,
    params: any[],
    options?: CallRawOptions,
  ): Promise<{ result?: any; error?: { code: number; message: string } }>;
}

class HttpProtocolClient implements RpcProtocolClient {
  readonly label = 'HTTP';

  async call(method: string, params: any[]): Promise<any> {
    return (global as any).relay.call(method, params);
  }

  async callRaw(method: string, params: any[], options?: CallRawOptions): Promise<any> {
    const url: string = (global as any).relay.provider._getConnection().url;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options?.ip) {
      headers['X-Forwarded-For'] = options.ip;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    });
    return resp.json();
  }
}

class WsProtocolClient implements RpcProtocolClient {
  readonly label = 'WebSocket';

  async call(method: string, params: any[]): Promise<any> {
    const response = await this.callRaw(method, params);
    if (response.error) {
      const err: any = new Error(response.error.message);
      err.code = response.error.code;
      throw err;
    }
    return response.result;
  }

  async callRaw(method: string, params: any[], options?: CallRawOptions): Promise<any> {
    if (options?.ip) {
      return WsTestHelper.sendRequestWithIp(method, params, options.ip);
    }
    return WsTestHelper.sendRequestToStandardWebSocket(method, params);
  }
}

export const ALL_PROTOCOL_CLIENTS: RpcProtocolClient[] = [new HttpProtocolClient(), new WsProtocolClient()];
