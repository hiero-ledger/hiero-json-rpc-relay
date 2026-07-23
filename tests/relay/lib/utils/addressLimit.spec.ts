// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { predefined } from '../../../../src/relay';
import {
  assertAddressCountWithinLimit,
  countAddresses,
  countBatchAddresses,
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

    it('should count an array as its length', () => {
      expect(countAddresses(['0xa', '0xb', '0xc'])).to.equal(3);
      expect(countAddresses([])).to.equal(0);
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
