// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { pino } from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { MirrorNodeClient } from '../../../../../src/relay/lib/clients/mirrorNodeClient';
import { CacheClientFactory } from '../../../../../src/relay/lib/factories/cacheClientFactory';
import { type ICommonService } from '../../../../../src/relay/lib/services';
import { BlockService } from '../../../../../src/relay/lib/services/ethService/blockService/BlockService';
import { TransactionTimestampIndexFactory } from '../../../../../src/relay/lib/services/transactionTimestampIndexService/TransactionTimestampIndexFactory';
import { WorkersPool } from '../../../../../src/relay/lib/services/workersService/WorkersPool';
import { RequestDetails } from '../../../../../src/relay/lib/types';
import { type IGetBlockWorkerResponse } from '../../../../../src/relay/lib/types/IGetBlockWorkerResponse';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

chai.use(chaiAsPromised);

const HASH_A = '0x9bca036bc5d34168f7b308bd4923b628a33b72349939819175a55496101eab02';
const HASH_B = '0xcd7a40ee08d9b86c732d2980cd50361a81f9502fe61dd8e8aebed3a1dccf8ef6';
const TS_A = '1786958468.715212954';
const TS_B = '1786958469.000000001';

describe('BlockService records synthetic consensus timestamps', function () {
  this.timeout(10000);

  overrideEnvsInMochaDescribe({ TX_TIMESTAMP_INDEX_ENABLED: true });

  const logger = pino({ level: 'silent' });
  const requestDetails = new RequestDetails({ requestId: 'block-index', ipAddress: '0.0.0.0' });

  let mirrorNodeClient: MirrorNodeClient;
  let blockService: BlockService;

  const workerResponse = (): IGetBlockWorkerResponse =>
    ({
      block: { number: '0x1', hash: '0x' + 'b'.repeat(64) } as any,
      syntheticTimestampEntries: [
        [HASH_A, TS_A],
        [HASH_B, TS_B],
      ],
    }) as IGetBlockWorkerResponse;

  beforeEach(() => {
    const registry = new Registry();
    const cacheService = CacheClientFactory.create(logger, registry);
    mirrorNodeClient = new MirrorNodeClient(
      'http://127.0.0.1:1',
      logger,
      registry,
      cacheService,
      undefined,
      undefined,
      undefined,
      TransactionTimestampIndexFactory.create(logger),
    );
    blockService = new BlockService(cacheService, '0x12a', {} as ICommonService, mirrorNodeClient, logger);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('records every entry the worker hands back, and returns the block unchanged', async () => {
    const response = workerResponse();
    sinon.stub(WorkersPool, 'run').resolves(response);

    const block = await blockService.getBlockByNumber('0x1', true, requestDetails);

    expect(block).to.equal(response.block);
    expect(await mirrorNodeClient.transactionTimestampIndex.get(HASH_A)).to.equal(TS_A);
    expect(await mirrorNodeClient.transactionTimestampIndex.get(HASH_B)).to.equal(TS_B);
  });

  it('records nothing when the block has no synthetic transactions', async () => {
    sinon.stub(WorkersPool, 'run').resolves({ block: { number: '0x1' } as any, syntheticTimestampEntries: [] });

    await blockService.getBlockByNumber('0x1', true, requestDetails);

    expect(await mirrorNodeClient.transactionTimestampIndex.get(HASH_A)).to.be.null;
  });

  it('returns null without recording when the block is not found', async () => {
    sinon.stub(WorkersPool, 'run').resolves(null);

    expect(await blockService.getBlockByNumber('0x1', true, requestDetails)).to.be.null;
    expect(await mirrorNodeClient.transactionTimestampIndex.get(HASH_A)).to.be.null;
  });

  it('still returns the block when recording fails', async () => {
    const response = workerResponse();
    sinon.stub(WorkersPool, 'run').resolves(response);
    sinon.stub(mirrorNodeClient.transactionTimestampIndex, 'setMany').rejects(new Error('redis is down'));

    expect(await blockService.getBlockByNumber('0x1', true, requestDetails)).to.equal(response.block);
  });

  // The reason the entries travel back as plain data instead of being written inside the worker: with the
  // pool enabled the worker may be a separate thread, which cannot share an index with this one.
  describe('with the worker pool enabled', () => {
    overrideEnvsInMochaDescribe({ WORKERS_POOL_ENABLED: true });

    it('records the entries on this thread after they cross the pool boundary', async () => {
      const response = workerResponse();
      // Stand in for Piscina: the task goes out, only serialisable data comes back.
      const previousInstance = (WorkersPool as any)['instance'];
      (WorkersPool as any)['instance'] = { run: async () => JSON.parse(JSON.stringify(response)) };

      try {
        const block = await blockService.getBlockByNumber('0x1', true, requestDetails);

        expect(block).to.deep.equal(response.block);
        expect(await mirrorNodeClient.transactionTimestampIndex.get(HASH_A)).to.equal(TS_A);
        expect(await mirrorNodeClient.transactionTimestampIndex.get(HASH_B)).to.equal(TS_B);
      } finally {
        (WorkersPool as any)['instance'] = previousInstance;
      }
    });
  });
});
