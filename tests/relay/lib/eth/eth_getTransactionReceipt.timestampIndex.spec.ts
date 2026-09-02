// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { RequestDetails } from '../../../../src/relay/lib/types';
import { DEFAULT_NETWORK_FEES } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

chai.use(chaiAsPromised);

const HASH = '0x9bca036bc5d34168f7b308bd4923b628a33b72349939819175a55496101eab02';
const TS = '1786958468.715212954';
const BLOCK_HASH = '0x' + 'b'.repeat(64);

/** A synthetic transfer log as the Mirror Node returns it for a CryptoTransfer. */
const syntheticLog = (transactionHash: string) => ({
  address: '0x0000000000000000000000000000000000120f46',
  bloom: '0x',
  contract_id: '0.0.1183558',
  data: '0x0000000000000000000000000000000000000000000000000000000000000001',
  index: 0,
  topics: [],
  block_hash: BLOCK_HASH,
  block_number: 39363179,
  root_contract_id: '0.0.1183558',
  timestamp: TS,
  transaction_hash: transactionHash,
  transaction_index: 0,
});

describe('@ethGetTransactionReceipt timestamp index fallback', function () {
  this.timeout(20000);

  const { ethImpl, mirrorNodeInstance, restMock, cacheService } = generateEthTestEnv();
  const requestDetails = new RequestDetails({ requestId: 'ts-index', ipAddress: '0.0.0.0' });

  /**
   * Stubs what the block path would have recorded. Stubbed rather than written, because a real entry
   * outlives `cacheService.clear()` - the index has its own store - and would leak into the next test.
   */
  const recordedTimestamp = (consensusTimestamp: string | null) =>
    sinon.stub(mirrorNodeInstance.transactionTimestampIndex, 'get').resolves(consensusTimestamp);

  /** Answers only the routes the fallback legitimately needs; records every path requested. */
  const stubMirrorNode = (logsForTimestampQuery: object[] | null) => {
    const paths: string[] = [];
    sinon.stub(mirrorNodeInstance, 'get' as any).callsFake(async (path: any) => {
      const p = String(path);
      paths.push(p);
      if (p.startsWith('blocks/')) {
        return { number: 39363179, hash: BLOCK_HASH, timestamp: { from: TS, to: TS } };
      }
      if (p.startsWith('network/fees')) {
        return DEFAULT_NETWORK_FEES;
      }
      if (p.includes(`timestamp=eq:${TS}`)) {
        return logsForTimestampQuery === null ? null : { logs: logsForTimestampQuery };
      }
      return null;
    });
    return paths;
  };

  const byHashPaths = (paths: string[]) =>
    paths.filter((p) => p.includes('transaction.hash') || p.includes(`results/${HASH}`));

  beforeEach(async () => {
    await cacheService.clear();
    restMock.reset();
    sinon.restore();
  });

  it('resolves the receipt from the recorded timestamp without using either by-hash route', async () => {
    recordedTimestamp(TS);
    const paths = stubMirrorNode([syntheticLog(HASH)]);

    const receipt = await ethImpl.getTransactionReceipt(HASH, requestDetails);

    expect(receipt).to.not.be.null;
    expect(receipt!.transactionHash).to.equal(HASH);
    expect(receipt!.blockNumber).to.equal('0x258a26b');
    expect(byHashPaths(paths), `by-hash routes must not be used, saw ${byHashPaths(paths)}`).to.deep.equal([]);
  });

  it('leaves the existing path untouched when the hash was never recorded', async () => {
    recordedTimestamp(null);
    const paths = stubMirrorNode([syntheticLog(HASH)]);

    expect(await ethImpl.getTransactionReceipt(HASH, requestDetails)).to.be.null;
    expect(
      paths.some((p) => p.includes(`results/${HASH}`)),
      'contract result by hash must be tried',
    ).to.be.true;
    expect(
      paths.some((p) => p.includes('transaction.hash')),
      'logs by hash must be tried',
    ).to.be.true;
  });

  it('falls through to the existing path when the recorded timestamp yields no logs', async () => {
    recordedTimestamp(TS);
    const paths = stubMirrorNode([]);

    expect(await ethImpl.getTransactionReceipt(HASH, requestDetails)).to.be.null;
    expect(
      paths.some((p) => p.includes(`results/${HASH}`)),
      'must fall through, not fail',
    ).to.be.true;
  });

  it('refuses logs that belong to another transaction at the same timestamp', async () => {
    recordedTimestamp(TS);
    const other = '0x' + 'c'.repeat(64);
    const paths = stubMirrorNode([syntheticLog(other)]);

    expect(await ethImpl.getTransactionReceipt(HASH, requestDetails)).to.be.null;
    expect(
      paths.some((p) => p.includes(`results/${HASH}`)),
      'must fall through, not fail',
    ).to.be.true;
  });

  it('falls through when the timestamp query itself fails', async () => {
    recordedTimestamp(TS);
    const paths: string[] = [];
    sinon.stub(mirrorNodeInstance, 'get' as any).callsFake(async (path: any) => {
      const p = String(path);
      paths.push(p);
      if (p.includes(`timestamp=eq:${TS}`)) {
        throw new Error('mirror node unavailable');
      }
      return null;
    });

    expect(await ethImpl.getTransactionReceipt(HASH, requestDetails)).to.be.null;
    expect(
      paths.some((p) => p.includes(`results/${HASH}`)),
      'must fall through, not fail',
    ).to.be.true;
  });
});
