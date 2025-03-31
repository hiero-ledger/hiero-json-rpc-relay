// SPDX-License-Identifier: Apache-2.0

import { keccak256 } from '@ethersproject/keccak256';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { Web3 } from '../index';
import { rpcMethod, rpcParamValidationRules } from './decorators';
import { ParamType } from './types';

export class Web3Impl implements Web3 {
  constructor() {}

  /**
   * Returns the client version.
   *
   * @rpcMethod Exposed as web3_clientVersion RPC endpoint
   *
   * @returns {string} The client version string.
   */
  @rpcMethod
  clientVersion(): string {
    return 'relay/' + ConfigService.get('npm_package_version');
  }

  /**
   * Computes the SHA3 (Keccak-256) hash of the given input.
   *
   * @rpcMethod Exposed as web3_sha3 RPC endpoint
   * @rpcParamValidationRules Applies JSON-RPC parameter validation according to the API specification
   *
   * @param {string} input - The input string to hash.
   * @returns {string} The SHA3 hash of the input.
   */
  @rpcMethod
  @rpcParamValidationRules({
    0: { type: ParamType.HEX, required: true },
  })
  sha3(input: string): string {
    return keccak256(input);
  }
}
