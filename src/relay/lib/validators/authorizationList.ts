// SPDX-License-Identifier: Apache-2.0

import type { Authorization } from 'ethers';

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
}
