// SPDX-License-Identifier: Apache-2.0

import type { Authorization } from 'ethers';

import constants from '../constants';
import { predefined } from '../errors/JsonRpcError';
import type { AuthorizationListEntry } from '../model';

type AuthorizationListTypes = AuthorizationListEntry[] | Authorization[];

export function validateAuthorizationList(
  type: number,
  authorizationList: AuthorizationListTypes | null | undefined,
): void {
  if (type !== 4 && authorizationList != null) {
    throw predefined.INVALID_PARAMETER('authorizationList', 'not supported for non-EIP-7702 transaction');
  }
  if (type === 4 && authorizationList == null) {
    throw predefined.INVALID_PARAMETER('authorizationList', 'EIP-7702 transaction with missing auth list');
  }
  if (type === 4 && authorizationList != null && authorizationList.length === 0) {
    throw predefined.INVALID_PARAMETER('authorizationList', 'EIP-7702 transaction with empty auth list');
  }

  // ethers decodes each tuple's `nonce` and `chainId` as arbitrary-precision BigInts, so
  // out-of-range values (e.g. a `nonce` of 2**64) survive RLP parsing. Without this check they
  // are forwarded to the consensus node, which rejects them with INVALID_ETHEREUM_TRANSACTION
  // only after the relay has already returned a transaction hash, so the failure never reaches
  // the caller. Per EIP-7702, `nonce` must fit in a uint64 and `chainId` in a uint256.
  if (type === 4 && authorizationList != null) {
    for (const authorization of authorizationList) {
      const nonce = BigInt(authorization.nonce);
      if (nonce > constants.UINT64_MAX) {
        throw predefined.INVALID_PARAMETER(
          'authorizationList',
          `authorization nonce '${nonce}' exceeds uint64 maximum of ${constants.UINT64_MAX}`,
        );
      }

      const chainId = BigInt(authorization.chainId);
      if (chainId > constants.UINT256_MAX) {
        throw predefined.INVALID_PARAMETER(
          'authorizationList',
          `authorization chainId '${chainId}' exceeds uint256 maximum of ${constants.UINT256_MAX}`,
        );
      }
    }
  }
}
