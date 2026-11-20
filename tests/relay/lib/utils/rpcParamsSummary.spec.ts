// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { keccak256 } from 'ethers';

import { summarizeRpcParams } from '../../../../src/relay/lib/utils/rpcParamsSummary';

describe('summarizeRpcParams', () => {
  const address = '0x00000000000000000000000000000000000004e2';
  const callData = '0x' + 'ab'.repeat(500);
  const rawTransaction = '0x02' + 'cd'.repeat(200);

  it('summarizes eth_getLogs as the block range and the number of addresses', () => {
    expect(
      summarizeRpcParams('eth_getLogs', [
        { fromBlock: '0x1', toBlock: 'latest', address: [address, address], topics: [['0x' + '1'.repeat(64)]] },
      ]),
    ).to.deep.equal({ fromBlock: '0x1', toBlock: 'latest', addresses: 2 });
  });

  it('summarizes eth_getLogs with a block hash and a single address', () => {
    const blockHash = '0x' + 'f'.repeat(64);
    expect(summarizeRpcParams('eth_getLogs', [{ blockHash, address }])).to.deep.equal({
      fromBlock: undefined,
      toBlock: undefined,
      blockHash,
      addresses: 1,
    });
  });

  it('summarizes eth_getLogs without a filter', () => {
    expect(summarizeRpcParams('eth_getLogs', [])).to.deep.equal({
      fromBlock: undefined,
      toBlock: undefined,
      addresses: 0,
    });
  });

  ['eth_call', 'eth_estimateGas'].forEach((method) => {
    it(`summarizes ${method} as from, to, the call data size and the block`, () => {
      const summary = summarizeRpcParams(method, [{ from: address, to: address, data: callData }, 'latest']);

      expect(summary).to.deep.equal({ from: address, to: address, dataSize: '500 bytes', block: 'latest' });
      expect(JSON.stringify(summary)).to.not.include('abab');
    });
  });

  it('reads the call data of eth_call from `input` too', () => {
    expect(summarizeRpcParams('eth_call', [{ to: address, input: '0x1234' }])).to.deep.equal({
      from: undefined,
      to: address,
      dataSize: '2 bytes',
    });
  });

  it('summarizes eth_sendRawTransaction as the transaction hash and size', () => {
    const summary = summarizeRpcParams('eth_sendRawTransaction', [rawTransaction]);

    expect(summary).to.deep.equal({ txHash: keccak256(rawTransaction), size: '201 bytes' });
    expect(JSON.stringify(summary)).to.not.include('cdcd');
  });

  it('does not hash an eth_sendRawTransaction payload that is not hex', () => {
    expect(summarizeRpcParams('eth_sendRawTransaction', ['x'.repeat(100)])).to.deep.equal({
      rawTransaction: '<100 chars>',
    });
  });

  it('keeps short params of other methods as they are', () => {
    expect(summarizeRpcParams('eth_getBlockByNumber', ['0x10', true])).to.deep.equal(['0x10', true]);
  });

  it('replaces long strings and arrays of other methods with their size', () => {
    const summary = summarizeRpcParams('debug_traceCall', [
      { to: address, data: callData, accessList: new Array(20).fill(address) },
      'latest',
    ]);

    expect(summary).to.deep.equal([{ to: address, data: '<500 bytes>', accessList: '<20 items>' }, 'latest']);
  });

  it('limits the depth of nested params', () => {
    expect(summarizeRpcParams('foo_bar', [{ a: { b: { c: 1 } } }])).to.deep.equal([{ a: { b: '<object>' } }]);
  });
});
