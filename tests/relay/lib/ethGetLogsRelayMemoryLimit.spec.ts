// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { ConfigService } from '../../../src/config-service/services';
import { MirrorNodeClient } from '../../../src/relay/lib/clients';
import { type JsonRpcError, predefined } from '../../../src/relay/lib/errors/JsonRpcError';
import { CacheClientFactory } from '../../../src/relay/lib/factories/cacheClientFactory';
import { Log } from '../../../src/relay/lib/model';
import { CommonService } from '../../../src/relay/lib/services';
import { getLogs } from '../../../src/relay/lib/services/ethService/ethCommonService/commonWorker';
import { type IWorkerContext } from '../../../src/relay/lib/services/workersService/workerContext';
import { WorkersPool } from '../../../src/relay/lib/services/workersService/WorkersPool';
import { type MirrorNodeContractLog, RequestDetails } from '../../../src/relay/lib/types';
import { GetLogsMemoryBudget, type GetLogsMemoryShare } from '../../../src/relay/lib/utils/getLogsMemoryBudget';
import { estimateLogsResponseSize, ResponseSizeBudget } from '../../../src/relay/lib/utils/responseSizeBudget';
import { withOverriddenEnvsInMochaTest } from '../helpers';

chai.use(chaiAsPromised);

describe('eth_getLogs relay-wide memory limit', function () {
  this.timeout(10000);

  const logger = pino({ level: 'silent' });
  const LOGS_REGEX = /contracts\/(?:[^/]+\/)?results\/logs/;
  const TIMESTAMP_RANGE = ['gte:1707944548.000000000', 'lte:1707944552.000000000'];
  const BUSY_MESSAGE = 'eth_getLogs memory limit reached on the relay, try again later';

  const log = (index: number): MirrorNodeContractLog =>
    ({
      address: '0x0000000000000000000000000000000000001389',
      bloom: '0x0123',
      contract_id: '0.0.5001',
      data: '0x0123',
      index,
      topics: ['0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750'],
      block_hash: '0xd773ec74b26ace67ee3924879a6bd35f3c4653baaa19f6c9baec7fac1269c55e',
      block_number: 73884554,
      timestamp: `1707944548.${String(index).padStart(9, '0')}`,
      transaction_hash: `0x${index.toString(16).padStart(64, '0')}`,
      transaction_index: 3,
    }) as MirrorNodeContractLog;

  const LOG_SIZE = estimateLogsResponseSize([log(0)]);

  let restMock: MockAdapter;
  let commonService: CommonService;
  let pagesServed: number;

  const requestDetailsWith = (share?: GetLogsMemoryShare): RequestDetails =>
    new RequestDetails({ requestId: 'relayMemoryLimitTest', ipAddress: '0.0.0.0', responseMemoryShare: share });

  // runs the eth_getLogs worker function on this thread, as the pool does when WORKERS_POOL_ENABLED is false
  const runGetLogs = (requestDetails: RequestDetails): Promise<Log[]> =>
    getLogs({ commonService } as unknown as IWorkerContext, null, '0x1', '0x2', null, null, requestDetails);

  // serves `pages` pages of `logsPerPage` logs each, every page but the last linking to the next one
  const serveLogPages = (pages: number, logsPerPage: number): void => {
    restMock.onGet(LOGS_REGEX).reply(() => {
      const page = pagesServed++;
      const logs = Array.from({ length: logsPerPage }, (_, i) => log(page * logsPerPage + i));
      const next = page < pages - 1 ? `/api/v1/contracts/results/logs?page=${page + 1}` : null;

      return [200, JSON.stringify({ logs, links: { next } })];
    });
  };

  const expectBusy = (error: unknown): void => {
    expect((error as JsonRpcError).code).to.equal(-32005);
    expect((error as JsonRpcError).message).to.equal(BUSY_MESSAGE);
    expect(ResponseSizeBudget.isExceededError(error)).to.be.true;
  };

  beforeEach(() => {
    pagesServed = 0;
    const registry = new Registry();
    const mirrorNodeClient = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: 'mirror-node' }),
      registry,
      CacheClientFactory.create(logger, registry),
    );
    restMock = new MockAdapter(mirrorNodeClient.getMirrorNodeRestInstance(), { onNoMatch: 'throwException' });
    commonService = new CommonService(mirrorNodeClient, logger, CacheClientFactory.create(logger, registry));
    sinon
      .stub(commonService, 'validateBlockRangeAndAddTimestampToParams')
      .callsFake(async (params, _fromBlock, _toBlock, _requestDetails, _address, sliceCountWrapper) => {
        params.timestamp = TIMESTAMP_RANGE;
        sliceCountWrapper!.value = 1;
        return true;
      });
  });

  afterEach(() => {
    restMock.restore();
    sinon.restore();
  });

  describe('worker pool off: pages are counted as they arrive', () => {
    it('counts every page of the call in the request share', async () => {
      const share = new GetLogsMemoryBudget(LOG_SIZE * 10).open();
      serveLogPages(2, 2);

      const logs = await runGetLogs(requestDetailsWith(share));

      expect(logs).to.have.length(4);
      expect(share.heldBytes).to.equal(LOG_SIZE * 4);
    });

    it('fails the call with the relay error on the page that does not fit, before fetching the next one', async () => {
      const share = new GetLogsMemoryBudget(LOG_SIZE * 3).open();
      serveLogPages(5, 2);

      const error = await runGetLogs(requestDetailsWith(share)).catch((e: unknown) => e);

      expectBusy(error);
      expect(share.isExceeded).to.be.true;
      expect(share.heldBytes).to.equal(0);
      expect(pagesServed).to.equal(2);
    });

    withOverriddenEnvsInMochaTest({ MIRROR_NODE_RETRIES: 0 }, () => {
      it('gives back the bytes of a call that fails for another reason', async () => {
        const share = new GetLogsMemoryBudget(LOG_SIZE * 10).open();
        restMock
          .onGet(LOGS_REGEX)
          .replyOnce(
            200,
            JSON.stringify({ logs: [log(0), log(1)], links: { next: '/api/v1/contracts/results/logs?page=1' } }),
          )
          .onGet(LOGS_REGEX)
          .replyOnce(500, JSON.stringify({ _status: { messages: [{ message: 'Internal error' }] } }));

        const error = await runGetLogs(requestDetailsWith(share)).catch((e: unknown) => e);

        expect(error).to.exist;
        expect(share.heldBytes).to.equal(0);
      });
    });

    withOverriddenEnvsInMochaTest({ ETH_GET_LOGS_MAX_RESPONSE_SIZE: LOG_SIZE * 3 }, () => {
      it('gives back only its own bytes when a call fails on its own limit, keeping those of the other calls', async () => {
        const share = new GetLogsMemoryBudget(LOG_SIZE * 10).open();
        share.consume(LOG_SIZE * 2);
        serveLogPages(5, 2);

        const error = await runGetLogs(requestDetailsWith(share)).catch((e: unknown) => e);

        expect((error as JsonRpcError).code).to.equal(predefined.LOGS_RESPONSE_SIZE_EXCEEDED(LOG_SIZE * 3).code);
        expect(share.heldBytes).to.equal(LOG_SIZE * 2);
      });
    });

    it('counts the calls of one request together, as for the entries of a batch', async () => {
      const share = new GetLogsMemoryBudget(LOG_SIZE * 5).open();
      serveLogPages(1, 3);

      const first = await runGetLogs(requestDetailsWith(share));
      expect(first).to.have.length(3);

      const error = await runGetLogs(requestDetailsWith(share)).catch((e: unknown) => e);

      expectBusy(error);
      expect(share.heldBytes).to.equal(LOG_SIZE * 3);
    });

    it('works as before when the request has no share', async () => {
      serveLogPages(2, 2);

      const logs = await runGetLogs(requestDetailsWith(undefined));

      expect(logs).to.have.length(4);
    });

    withOverriddenEnvsInMochaTest({ WORKERS_POOL_ENABLED: false }, () => {
      it('does not count the result a second time on the main thread', async () => {
        const share = new GetLogsMemoryBudget(LOG_SIZE * 10).open();
        sinon.stub(WorkersPool, 'run').resolves([Log.fromMirrorNodeContractLog(log(0))]);

        await commonService.getLogs(null, '0x1', '0x2', null, null, requestDetailsWith(share));

        expect(share.heldBytes).to.equal(0);
      });
    });
  });

  describe('worker pool on: the result is counted when it reaches the main thread', () => {
    withOverriddenEnvsInMochaTest({ WORKERS_POOL_ENABLED: true }, () => {
      const workerResult = (count: number): Log[] =>
        Array.from({ length: count }, (_, i) => Log.fromMirrorNodeContractLog(log(i)));

      it('counts the estimated size of the returned logs in the request share', async () => {
        const share = new GetLogsMemoryBudget(LOG_SIZE * 10).open();
        sinon.stub(WorkersPool, 'run').resolves(workerResult(3));

        const logs = await commonService.getLogs(null, '0x1', '0x2', null, null, requestDetailsWith(share));

        expect(logs).to.have.length(3);
        expect(share.heldBytes).to.equal(LOG_SIZE * 3);
      });

      it('fails with the relay error and drops the logs when the result does not fit', async () => {
        const share = new GetLogsMemoryBudget(LOG_SIZE * 2).open();
        sinon.stub(WorkersPool, 'run').resolves(workerResult(3));

        const error = await commonService
          .getLogs(null, '0x1', '0x2', null, null, requestDetailsWith(share))
          .catch((e: unknown) => e);

        expectBusy(error);
        expect(share.heldBytes).to.equal(0);
      });
    });
  });

  it('estimates a Log entry the same as the mirror node log it was built from', () => {
    const mirrorNodeLogs = [log(0), { ...log(1), data: `0x${'ab'.repeat(512)}`, topics: [] }];
    const entries = mirrorNodeLogs.map((mirrorNodeLog) => Log.fromMirrorNodeContractLog(mirrorNodeLog));

    expect(estimateLogsResponseSize(entries)).to.equal(estimateLogsResponseSize(mirrorNodeLogs));
  });
});
