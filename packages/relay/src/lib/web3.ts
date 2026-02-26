// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { Web3 } from '../index';
import { rpcMethod } from './decorators';
import { rpcParamValidationRules } from './validators';

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
    0: { type: 'hex', required: true },
  })
  sha3(input: string): string {
    const inputBytes = hexToBytes(input.startsWith('0x') ? input.slice(2) : input);
    return '0x' + bytesToHex(keccak_256(inputBytes));
  }
}
