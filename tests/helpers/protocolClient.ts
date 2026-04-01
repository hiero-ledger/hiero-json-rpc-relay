// SPDX-License-Identifier: Apache-2.0

import { WsTestConstant, WsTestHelper } from '../ws-server/helper';

/**
 * Unified transport abstraction for protocol-parameterized acceptance tests.
 * Implementations normalize both HTTP and WebSocket transports to the same
 * interface: returns the RPC result directly, throws on error.
 */
export interface RpcProtocolClient {
  readonly label: string;
  call(method: string, params: any[]): Promise<any>;
}

class HttpProtocolClient implements RpcProtocolClient {
  readonly label = 'HTTP';

  async call(method: string, params: any[]): Promise<any> {
    return (global as any).relay.call(method, params);
  }
}

class WsProtocolClient implements RpcProtocolClient {
  readonly label = 'WebSocket';

  async call(method: string, params: any[]): Promise<any> {
    const response = await WsTestHelper.sendRequestToStandardWebSocket(method, params);
    if (response.error) {
      const err: any = new Error(response.error.message);
      err.code = response.error.code;
      throw err;
    }
    return response.result;
  }
}

export const ALL_PROTOCOL_CLIENTS: RpcProtocolClient[] = [new HttpProtocolClient(), new WsProtocolClient()];
