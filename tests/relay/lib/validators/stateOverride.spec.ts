// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';

import { validateStateOverrideSet } from '../../../../src/relay/lib/validators/stateOverride';

describe('validateStateOverrideSet', () => {
  const ADDRESS = `0x${'ab'.repeat(20)}`;
  const SLOT = `0x${'0'.repeat(63)}3`;
  const VALUE = `0x${'0'.repeat(63)}1`;
  const addressAt = (n: number): string => `0x${n.toString(16).padStart(40, '0')}`;

  describe('shape', () => {
    it('should accept an empty override set', () => {
      expect(() => validateStateOverrideSet({})).not.to.throw();
    });

    it('should accept an entry with no fields', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: {} })).not.to.throw();
    });

    it('should reject an array', () => {
      expect(() => validateStateOverrideSet([])).to.throw('Expected an object keyed by address');
    });

    it('should reject a non-object', () => {
      expect(() => validateStateOverrideSet('0x1')).to.throw('Expected an object keyed by address');
    });

    it('should reject an entry that is not an object', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: '0x1' })).to.throw('must map to an object');
    });
  });

  describe('addresses', () => {
    it('should reject a key that is not a 20 byte address', () => {
      expect(() => validateStateOverrideSet({ '0x123': {} })).to.throw('is not a valid 20 byte address');
    });

    it('should accept 10 addresses', () => {
      const overrides = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [addressAt(i + 1), {}]));
      expect(() => validateStateOverrideSet(overrides)).not.to.throw();
    });

    it('should reject more than 10 addresses', () => {
      const overrides = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [addressAt(i + 1), {}]));
      expect(() => validateStateOverrideSet(overrides)).to.throw('maximum of 10 addresses');
    });
  });

  describe('balance', () => {
    it('should accept a hex balance', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { balance: '0x56bc75e2d63100000' } })).not.to.throw();
    });

    it('should accept leading zeros', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { balance: '0x0001' } })).not.to.throw();
    });

    it('should reject a non-hex balance', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { balance: '1000' } })).to.throw('balance expected 0x');
    });

    it('should reject a bare 0x prefix', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { balance: '0x' } })).to.throw('balance expected 0x');
    });

    it('should reject an uppercase 0X prefix', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { balance: '0X1' } })).to.throw('balance expected 0x');
    });
  });

  describe('nonce', () => {
    it('should accept a nonce at the maximum', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { nonce: '0x7fffffffffffffff' } })).not.to.throw();
    });

    it('should reject a nonce above the maximum', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { nonce: '0x8000000000000000' } })).to.throw(
        'nonce exceeds the maximum',
      );
    });

    it('should reject a non-hex nonce', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { nonce: '5' } })).to.throw('nonce expected 0x');
    });
  });

  describe('code', () => {
    it('should accept code at the maximum length', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { code: `0x${'a'.repeat(24576 * 2 - 2)}` } })).not.to.throw();
    });

    it('should reject code above the maximum length', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { code: `0x${'a'.repeat(24576 * 2)}` } })).to.throw(
        'code exceeds the maximum',
      );
    });
  });

  describe('storage', () => {
    it('should accept a 32 byte slot key and value', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { stateDiff: { [SLOT]: VALUE } } })).not.to.throw();
    });

    it('should reject a short slot key', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { stateDiff: { '0x3': VALUE } } })).to.throw(
        'slots must be 0x prefixed 32 byte hexadecimal values',
      );
    });

    it('should reject a short slot value', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { state: { [SLOT]: '0x1' } } })).to.throw(
        'slots must be 0x prefixed 32 byte hexadecimal values',
      );
    });

    it('should reject more than 100 slots', () => {
      const storage = Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [`0x${i.toString(16).padStart(64, '0')}`, VALUE]),
      );
      expect(() => validateStateOverrideSet({ [ADDRESS]: { state: storage } })).to.throw('exceeds the maximum of 100');
    });

    it('should accept an empty state map', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { state: {} } })).not.to.throw();
    });
  });

  describe('state and stateDiff', () => {
    it('should accept state on its own', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { state: { [SLOT]: VALUE } } })).not.to.throw();
    });

    it('should reject both together', () => {
      expect(() =>
        validateStateOverrideSet({ [ADDRESS]: { state: { [SLOT]: VALUE }, stateDiff: { [SLOT]: VALUE } } }),
      ).to.throw("has both 'state' and 'stateDiff'");
    });

    it('should reject both together even when both are empty', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { state: {}, stateDiff: {} } })).to.throw(
        "has both 'state' and 'stateDiff'",
      );
    });
  });

  describe('movePrecompileToAddress', () => {
    it('should reject it', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { movePrecompileToAddress: ADDRESS } })).to.throw(
        "'movePrecompileToAddress' is not supported",
      );
    });

    it('should reject it even when undefined, since the key is present', () => {
      expect(() => validateStateOverrideSet({ [ADDRESS]: { movePrecompileToAddress: undefined } })).to.throw(
        "'movePrecompileToAddress' is not supported",
      );
    });
  });
});
