// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { JsonRpcError, Net, predefined } from '../index';
import { rpcMethod } from './decorators';

export class NetImpl implements Net {
  private readonly chainId: string;

  constructor() {
    this.chainId = parseInt(ConfigService.get('CHAIN_ID'), 16).toString();
  }

  /**
   * Indicates whether the client is actively listening for network connections.
   * We always return true for this.
   *
   * @rpcMethod Exposed as net_listening RPC endpoint
   *
   * @returns {boolean} Always returns true to indicate the client is listening.
   */
  @rpcMethod
  listening(): boolean {
    return true;
  }

  /**
   * Returns the current chain ID.
   *
   * @rpcMethod Exposed as net_version RPC endpoint
   *
   * @returns {string} The chain ID configured for this relay.
   */
  @rpcMethod
  version(): string {
    return this.chainId;
  }

  /**
   * Returns the number of peers currently connected to the client.
   *
   * @rpcMethod Exposed as net_peerCount RPC endpoint
   *
   * @returns {JsonRpcError} Always returns UNSUPPORTED_METHOD error as this method is not supported.
   */
  @rpcMethod
  peerCount(): JsonRpcError {
    return predefined.UNSUPPORTED_METHOD;
  }
}
