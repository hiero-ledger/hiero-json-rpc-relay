// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { isBlockHash, normalizeBlockParam } from '../../../../src/relay/lib/utils/blockParam';

describe('blockParam', () => {
  const blockHash = '0x' + 'ab'.repeat(32);

  describe('isBlockHash', () => {
    it('should accept a 0x prefixed 32 byte hex string', () => {
      expect(isBlockHash(blockHash)).to.be.true;
      expect(isBlockHash(blockHash.toUpperCase().replace('0X', '0x'))).to.be.true;
    });

    it('should reject block numbers, tags, short hashes and non-strings', () => {
      for (const value of [
        '0x1',
        'latest',
        '0x' + 'a'.repeat(63),
        '0x' + 'a'.repeat(65),
        null,
        undefined,
        1,
        [blockHash],
      ]) {
        expect(isBlockHash(value), JSON.stringify(value)).to.be.false;
      }
    });
  });

  describe('normalizeBlockParam', () => {
    it('should return strings unchanged', () => {
      for (const value of ['0x1', 'latest', 'earliest', 'pending', 'safe', 'finalized', blockHash]) {
        expect(normalizeBlockParam(value)).to.equal(value);
      }
    });

    it('should unwrap a blockNumber object', () => {
      expect(normalizeBlockParam({ blockNumber: '0x1' })).to.equal('0x1');
      expect(normalizeBlockParam({ blockNumber: 'latest' })).to.equal('latest');
    });

    it('should unwrap a blockHash object and drop requireCanonical', () => {
      expect(normalizeBlockParam({ blockHash })).to.equal(blockHash);
      expect(normalizeBlockParam({ blockHash, requireCanonical: true })).to.equal(blockHash);
      expect(normalizeBlockParam({ blockHash, requireCanonical: false })).to.equal(blockHash);
    });

    it('should leave null, undefined and arrays untouched', () => {
      expect(normalizeBlockParam(null)).to.be.null;
      expect(normalizeBlockParam(undefined)).to.be.undefined;
      expect(normalizeBlockParam(['0x1'])).to.deep.equal(['0x1']);
    });
  });
});
