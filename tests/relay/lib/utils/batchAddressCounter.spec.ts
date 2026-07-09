// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import {
  countBatchAddresses,
  HTTP_BATCH_ADDRESS_METHODS,
  WS_BATCH_ADDRESS_METHODS,
} from '../../../../src/relay/lib/utils/batchAddressCounter';

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
