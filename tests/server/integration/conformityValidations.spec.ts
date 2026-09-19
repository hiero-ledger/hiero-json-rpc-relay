// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { hasResponseFormatIssues } from '../acceptance/data/conformity/utils/validations';

describe('conformity response comparison', function () {
  describe('## wildcard directive', function () {
    const expected = { result: { number: '0x1', hash: '0xaaa' } };

    it('suppresses a value that differs', function () {
      const actual = { result: { number: '0x1', hash: '0xsomethingelse' } };
      expect(hasResponseFormatIssues(actual, expected, ['result.hash'])).to.be.false;
    });

    it('reports a value that differs and is not wildcarded', function () {
      const actual = { result: { number: '0x1', hash: '0xsomethingelse' } };
      expect(hasResponseFormatIssues(actual, expected, [])).to.be.true;
    });

    it('accepts a wildcarded field that the response omits entirely', function () {
      const actual = { result: { number: '0x1' } };
      expect(hasResponseFormatIssues(actual, expected, ['result.hash'])).to.be.false;
    });

    it('reports a missing field that is not wildcarded', function () {
      const actual = { result: { number: '0x1' } };
      expect(hasResponseFormatIssues(actual, expected, [])).to.be.true;
    });

    it('applies to a path inside an array entry', function () {
      const recorded = { result: { transactions: [{ hash: '0xaaa', type: '0x0' }] } };
      const actual = { result: { transactions: [{ hash: '0xsomethingelse', type: '0x0' }] } };
      expect(hasResponseFormatIssues(actual, recorded, ['result.transactions[0].hash'])).to.be.false;
    });
  });

  describe('## contains directive', function () {
    const expected = { result: { number: '0x1', transactions: [{ hash: '0xaaa', type: '0x0' }] } };
    const path = 'result.transactions';

    const blockWith = (...transactions: Record<string, string>[]): Record<string, unknown> => ({
      result: { number: '0x1', transactions },
    });

    it('reports a mismatch without the directive when the block carries other transactions', function () {
      const actual = blockWith({ hash: '0xzzz', type: '0x0' }, { hash: '0xaaa', type: '0x0' });
      expect(hasResponseFormatIssues(actual, expected, [])).to.be.true;
    });

    it('matches with the directive when the recorded entry is present among others', function () {
      const actual = blockWith({ hash: '0xzzz', type: '0x0' }, { hash: '0xaaa', type: '0x0' });
      expect(hasResponseFormatIssues(actual, expected, [], [path])).to.be.false;
    });

    it('still reports a mismatch when the recorded entry is absent', function () {
      const actual = blockWith({ hash: '0xzzz', type: '0x0' });
      expect(hasResponseFormatIssues(actual, expected, [], [path])).to.be.true;
    });

    it('still reports a mismatch when the array is empty', function () {
      expect(hasResponseFormatIssues(blockWith(), expected, [], [path])).to.be.true;
    });

    it('applies wildcards to fields of a contained entry', function () {
      const actual = blockWith({ hash: '0xsomethingelse', type: '0x0' });
      expect(hasResponseFormatIssues(actual, expected, [`${path}[0].hash`], [path])).to.be.false;
    });

    it('leaves arrays without the directive strictly compared', function () {
      const actual = blockWith({ hash: '0xaaa', type: '0x0' }, { hash: '0xbbb', type: '0x0' });
      expect(hasResponseFormatIssues(actual, expected, [])).to.be.true;
    });
  });
});
