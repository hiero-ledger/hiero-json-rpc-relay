// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import fc from 'fast-check';

import {
  ASCIIToHex,
  hexToASCII,
  isHex,
  nanOrNumberInt64To0x,
  numberTo0x,
  prepend0x,
  strip0x,
  trimPrecedingZeros,
} from '../../../src/relay/formatters';

const INT64_MIN = -(BigInt(1) << BigInt(63));
const INT64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

// non-empty lowercase hex string without the 0x prefix
const hexDigits = fc
  .array(fc.constantFrom(...'0123456789abcdef'), { minLength: 1, maxLength: 64 })
  .map((chars) => chars.join(''));

// printable ASCII (0x20..0x7e), the range ASCIIToHex encodes with two hex digits per character
const printableAscii = fc.array(fc.integer({ min: 0x20, max: 0x7e })).map((codes) => String.fromCharCode(...codes));

describe('Formatters property-based tests', () => {
  describe('prepend0x / strip0x', () => {
    it('prepend0x is idempotent and strip0x inverts it', () => {
      fc.assert(
        fc.property(hexDigits, (hex) => {
          const prefixed = prepend0x(hex);
          expect(prefixed).to.equal(`0x${hex}`);
          expect(prepend0x(prefixed)).to.equal(prefixed);
          expect(strip0x(prefixed)).to.equal(hex);
          expect(strip0x(hex)).to.equal(hex);
          expect(isHex(prefixed)).to.be.true;
        }),
      );
    });
  });

  describe('numberTo0x / trimPrecedingZeros', () => {
    it('round-trips any non-negative integer through its 0x-prefixed hex form', () => {
      fc.assert(
        fc.property(fc.bigInt({ min: BigInt(0), max: UINT256_MAX }), (value) => {
          const hex = numberTo0x(value);
          expect(isHex(hex)).to.be.true;
          expect(BigInt(hex)).to.equal(value);
          expect(trimPrecedingZeros(hex)).to.equal(value.toString(16));
        }),
      );
    });

    it('trimPrecedingZeros ignores any number of leading zeros and an optional 0x prefix', () => {
      fc.assert(
        fc.property(hexDigits, fc.nat({ max: 16 }), (hex, zeros) => {
          const expected = trimPrecedingZeros(hex);
          expect(trimPrecedingZeros('0'.repeat(zeros) + hex)).to.equal(expected);
          expect(trimPrecedingZeros(`0x${'0'.repeat(zeros)}${hex}`)).to.equal(expected);
        }),
      );
    });
  });

  describe('nanOrNumberInt64To0x', () => {
    it("encodes any int64 as two's complement that decodes back to the same value", () => {
      fc.assert(
        fc.property(fc.bigInt({ min: INT64_MIN, max: INT64_MAX }), (value) => {
          const hex = nanOrNumberInt64To0x(value);
          expect(isHex(hex)).to.be.true;
          expect(BigInt.asIntN(64, BigInt(hex))).to.equal(value);
          expect(nanOrNumberInt64To0x(value.toString())).to.equal(hex);
        }),
      );
    });
  });

  describe('ASCIIToHex / hexToASCII', () => {
    it('round-trips printable ASCII strings', () => {
      fc.assert(
        fc.property(printableAscii, (text) => {
          const hex = ASCIIToHex(text);
          expect(hex).to.have.lengthOf(text.length * 2);
          expect(hexToASCII(hex)).to.equal(text);
        }),
      );
    });
  });
});
