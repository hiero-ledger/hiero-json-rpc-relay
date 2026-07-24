// SPDX-License-Identifier: Apache-2.0

// Importing the production module applies the bignumber.js configuration as a
// side effect, exactly as mirrorNodeClient does before it parses any response.
import '../../../src/relay/lib/bigNumberConfig';

import BigNumber from 'bignumber.js';
import { expect } from 'chai';
import JSONBigInt from 'json-bigint';

import { nanOrNumberInt64To0x } from '../../../src/relay/formatters';

describe('bigNumberConfig', () => {
  it('renders large integers without exponential notation', () => {
    // Under the bignumber.js default this would serialize as "1e+21".
    expect(new BigNumber('1e21').toJSON()).to.equal('1000000000000000000000');
    expect(new BigNumber('1e21').toString()).to.equal('1000000000000000000000');
    // EVM `value` is a uint256 (max ~1.16e77); the threshold must clear that whole range.
    expect(new BigNumber('1e40').toString()).to.equal('1' + '0'.repeat(40));
  });

  it('keeps a large Mirror Node amount intact across the json-bigint parse + Redis JSON round-trip', () => {
    // Mirror Node returns large integers as raw JSON numbers; mirrorNodeClient parses them with json-bigint.
    const parsed = JSONBigInt.parse('{"amount":1000000000000000000000}');
    // RedisCache serializes with native JSON.stringify on set and JSON.parse on get.
    const roundTripped = JSON.parse(JSON.stringify(parsed));
    // debug.ts formats the amount with nanOrNumberInt64To0x, which calls BigInt() on the value.
    expect(nanOrNumberInt64To0x(roundTripped.amount)).to.equal('0x3635c9adc5dea00000');
  });
});
