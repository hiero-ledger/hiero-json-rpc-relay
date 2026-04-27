// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';

import type { AuthorizationListEntry } from '../../../../src/relay/lib/model';
import { validateAuthorizationList } from '../../../../src/relay/lib/validators/authorizationList';
import { contractAddress1 } from '../../../helpers';

describe('validateAuthorizationList', () => {
  const authEntry = {
    chainId: '0x12a',
    address: contractAddress1,
    nonce: '0x0',
    r: `0x${'aa'.repeat(32)}`,
    s: `0x${'bb'.repeat(32)}`,
    yParity: '0x0',
  } as unknown as AuthorizationListEntry;

  describe('non-type-4 transactions', () => {
    it('should not throw for type 2 tx without authorizationList', () => {
      expect(() => validateAuthorizationList(2, undefined)).not.to.throw();
    });

    it('should not throw for type 1 tx without authorizationList', () => {
      expect(() => validateAuthorizationList(1, undefined)).not.to.throw();
    });

    it('should not throw for type 0 tx without authorizationList', () => {
      expect(() => validateAuthorizationList(0, undefined)).not.to.throw();
    });

    it('should throw for type 2 tx with authorizationList', () => {
      expect(() => validateAuthorizationList(2, [authEntry])).to.throw('not supported for non-EIP-7702 transaction');
    });

    it('should throw for type 1 tx with authorizationList', () => {
      expect(() => validateAuthorizationList(1, [authEntry])).to.throw('not supported for non-EIP-7702 transaction');
    });

    it('should throw for type 0 tx with authorizationList', () => {
      expect(() => validateAuthorizationList(0, [authEntry])).to.throw('not supported for non-EIP-7702 transaction');
    });

    it('should throw for type 2 tx with empty authorizationList array', () => {
      expect(() => validateAuthorizationList(2, [])).to.throw('not supported for non-EIP-7702 transaction');
    });
  });

  describe('type 4 transactions', () => {
    it('should not throw for type 4 tx with non-empty authorizationList', () => {
      expect(() => validateAuthorizationList(4, [authEntry])).not.to.throw();
    });

    it('should throw for type 4 tx without authorizationList', () => {
      expect(() => validateAuthorizationList(4, undefined)).to.throw('EIP-7702 transaction with missing auth list');
    });

    it('should throw for type 4 tx with null authorizationList', () => {
      expect(() => validateAuthorizationList(4, null)).to.throw('EIP-7702 transaction with missing auth list');
    });

    it('should throw for type 4 tx with empty authorizationList', () => {
      expect(() => validateAuthorizationList(4, [])).to.throw('EIP-7702 transaction with empty auth list');
    });
  });
});
