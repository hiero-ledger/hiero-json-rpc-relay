// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { predefined } from '../../../../src/relay';
import {
  assertAddressCountWithinLimit,
  countAddresses,
  countBatchAddresses,
  dedupeAddresses,
  HTTP_BATCH_ADDRESS_METHODS,
  WS_BATCH_ADDRESS_METHODS,
} from '../../../../src/relay/lib/utils/addressLimit';
import { withOverriddenEnvsInMochaTest } from '../../helpers';

describe('addressLimit', () => {
  describe('countAddresses', () => {
    it('should count null/undefined as 0', () => {
      expect(countAddresses(null)).to.equal(0);
      expect(countAddresses(undefined)).to.equal(0);
    });

    it('should count a single address string as 1', () => {
      expect(countAddresses('0xabc')).to.equal(1);
    });

    it('should count an array of distinct addresses as its length', () => {
      expect(countAddresses(['0xa', '0xb', '0xc'])).to.equal(3);
      expect(countAddresses([])).to.equal(0);
    });

    it('should collapse duplicate addresses case-insensitively', () => {
      expect(countAddresses(['0xa', '0xa'])).to.equal(1);
      expect(countAddresses(['0xAbC', '0xabc', '0xABC'])).to.equal(1);
      expect(countAddresses(['0xa', '0xB', '0xa', '0xb'])).to.equal(2);
    });

    it('should drop non-string entries', () => {
      expect(countAddresses([null, null, null])).to.equal(0);
      expect(countAddresses(['0xa', null, 42])).to.equal(1);
    });

    it('should collapse entries that differ only by surrounding whitespace and drop blank ones', () => {
      expect(countAddresses(['0xa', ' 0xa ', '\t0xA\n'])).to.equal(1);
      expect(countAddresses(['   ', '', '0xa'])).to.equal(1);
    });
  });

  describe('dedupeAddresses', () => {
    it('should return an empty array for null/undefined', () => {
      expect(dedupeAddresses(null)).to.deep.equal([]);
      expect(dedupeAddresses(undefined)).to.deep.equal([]);
    });

    it('should wrap a single address string in a one-element array', () => {
      expect(dedupeAddresses('0xabc')).to.deep.equal(['0xabc']);
    });

    it('should dedupe case-insensitively, preserving first-seen order and casing', () => {
      expect(dedupeAddresses(['0xAbC', '0xabc', '0xB', '0xb'])).to.deep.equal(['0xAbC', '0xB']);
    });

    it('should drop non-string entries', () => {
      expect(dedupeAddresses([null, '0xa', undefined, 42])).to.deep.equal(['0xa']);
    });

    it('should trim surrounding whitespace, dedupe on the trimmed value, and drop blank entries', () => {
      expect(dedupeAddresses([' 0xAbC ', '\t0xabc\n', '   ', ''])).to.deep.equal(['0xAbC']);
      expect(dedupeAddresses('  0xa  ')).to.deep.equal(['0xa']);
    });
  });

  describe('assertAddressCountWithinLimit', () => {
    withOverriddenEnvsInMochaTest({ MAX_ADDRESSES_PER_REQUEST: 2 }, () => {
      it('should not throw when the count is at or under the cap', () => {
        expect(() => assertAddressCountWithinLimit(null)).to.not.throw();
        expect(() => assertAddressCountWithinLimit('0xa')).to.not.throw();
        expect(() => assertAddressCountWithinLimit(['0xa', '0xb'])).to.not.throw();
      });

      it('should throw INVALID_PARAMETER when the count exceeds the cap', () => {
        const expected = predefined.INVALID_PARAMETER('address', 'A maximum of 2 addresses are allowed');
        expect(() => assertAddressCountWithinLimit(['0xa', '0xb', '0xc']))
          .to.throw()
          .that.deep.includes({ code: expected.code, message: expected.message });
      });
    });
  });

  describe('countBatchAddresses', () => {
    const getLogs = (addresses: string[] | string | null) => ({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_getLogs',
      params: [{ address: addresses, fromBlock: '0x0', toBlock: 'latest' }],
    });

    const subscribe = (addresses: string[] | string | null) => ({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_subscribe',
      params: ['logs', { address: addresses }],
    });

    it('should count getLogs addresses (array and single string) and sum across entries', () => {
      const batch = [getLogs(['0xa', '0xb']), getLogs('0xc')];
      expect(countBatchAddresses(batch, HTTP_BATCH_ADDRESS_METHODS)).to.equal(3);
    });

    it('should sum getLogs and subscribe together, reading the subscribe address from params[1]', () => {
      const batch = [getLogs(['0xa', '0xb']), subscribe(['0xc', '0xd', '0xe'])];
      expect(countBatchAddresses(batch, WS_BATCH_ADDRESS_METHODS)).to.equal(5);
    });

    it('should only count methods in the provided set', () => {
      // HTTP set counts eth_getLogs only: the subscribe and the non-address method are ignored.
      const batch = [
        getLogs('0xa'),
        subscribe(['0xb', '0xc', '0xd']),
        { id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] },
      ];
      expect(countBatchAddresses(batch, HTTP_BATCH_ADDRESS_METHODS)).to.equal(1);
    });

    it('should dedupe duplicate addresses within an entry, but count them per-entry across the batch', () => {
      // Within one entry duplicates collapse (one fan-out), but two separate entries each fetch their own
      // addresses, so the same address in two entries counts twice.
      expect(countBatchAddresses([getLogs(['0xa', '0xa', '0xB', '0xb'])], HTTP_BATCH_ADDRESS_METHODS)).to.equal(2);
      expect(countBatchAddresses([getLogs('0xa'), getLogs('0xa')], HTTP_BATCH_ADDRESS_METHODS)).to.equal(2);
    });

    it('should treat a missing or null address as 0', () => {
      expect(countBatchAddresses([getLogs(null)], HTTP_BATCH_ADDRESS_METHODS)).to.equal(0);
      const noAddress = { id: 1, jsonrpc: '2.0', method: 'eth_getLogs', params: [{ fromBlock: '0x0' }] };
      expect(countBatchAddresses([noAddress], HTTP_BATCH_ADDRESS_METHODS)).to.equal(0);
    });

    it('should tolerate malformed entries without throwing and keep counting valid ones', () => {
      const batch: unknown[] = [
        null,
        'not-an-object',
        42,
        { id: 1, jsonrpc: '2.0', method: 'eth_getLogs' }, // no params
        { id: 2, jsonrpc: '2.0', method: 'eth_getLogs', params: 'bad' }, // params not an array
        { id: 3, jsonrpc: '2.0', method: 'eth_getLogs', params: [] }, // param at index missing (undefined)
        { id: 4, jsonrpc: '2.0', method: 'eth_getLogs', params: [null] }, // filter null
        getLogs(['0xa', '0xb']), // valid entry still counted after the malformed ones
      ];
      expect(countBatchAddresses(batch, WS_BATCH_ADDRESS_METHODS)).to.equal(2);
    });
  });
});
