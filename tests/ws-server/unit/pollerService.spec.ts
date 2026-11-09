// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import { type Counter, type Gauge } from 'prom-client';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { ConfigService } from '../../../src/config-service/services';
import { predefined, Relay } from '../../../src/relay';
import { numberTo0x } from '../../../src/relay/formatters';
import { MirrorNodeClient } from '../../../src/relay/lib/clients';
import { EthImpl } from '../../../src/relay/lib/eth';
import { type Block, Log } from '../../../src/relay/lib/model';
import { TxPoolImpl, type TxPoolTransaction } from '../../../src/relay/lib/txpool';
import {
  type IContractLogsResultsParams,
  type MirrorNodeBlock,
  type MirrorNodeContractLog,
} from '../../../src/relay/lib/types';
import { PollerService } from '../../../src/ws-server/service/pollerService';
import recorded from './fixtures/mainnetContractLogs.json';

const logger = pino({ level: 'trace' });

const INTERVAL = 1000;
const EVM_ADDRESS = '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69';
const LONG_ZERO = '0x00000000000000000000000000000000000003e9';
const OTHER_LONG_ZERO = '0x00000000000000000000000000000000000003ea';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

const pad = (hex: string): string => `0x${hex.replace(/^0x/, '').padStart(64, '0')}`;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sent = (callback: sinon.SinonStub): string[] => callback.args.map(([log]) => (log as Log).data);

describe('PollerService', async function () {
  const logsTag = `{"event":"logs","filters":{"address":"${EVM_ADDRESS}","topics":["${TRANSFER}"]}}`;
  const newHeadsTag = '{"event":"newHeads","filters":{}}';
  const pendingTx = { hash: '0xabc' } as TxPoolTransaction;

  let relayImplStub: sinon.SinonStubbedInstance<Relay>;
  let ethImplStub: sinon.SinonStubbedInstance<EthImpl>;
  let mirrorNodeStub: sinon.SinonStubbedInstance<MirrorNodeClient>;
  let txpoolStub: sinon.SinonStubbedInstance<TxPoolImpl>;
  let poller: PollerService;
  let sandbox: sinon.SinonSandbox;
  let loggerInfoSpy: sinon.SinonSpy;
  let clock: sinon.SinonFakeTimers;
  let configServiceStub: sinon.SinonStub;
  let activePollsGaugeSpy: { inc: sinon.SinonSpy; dec: sinon.SinonSpy };
  let activeNewHeadsPollsGaugeSpy: { inc: sinon.SinonSpy; dec: sinon.SinonSpy };
  let registry: Registry;

  let head: number;
  let chainLogs: MirrorNodeContractLog[];

  const log = (block: number, data: string, overrides: Partial<MirrorNodeContractLog> = {}): MirrorNodeContractLog => ({
    address: EVM_ADDRESS,
    bloom: '0x',
    contract_id: '0.0.1001',
    data,
    index: 0,
    topics: [TRANSFER],
    block_hash: pad(block.toString(16)),
    block_number: block,
    timestamp: `${block}.000000001`,
    transaction_hash: pad(data),
    transaction_index: 0,
    ...overrides,
  });

  const blockRange = (params?: IContractLogsResultsParams): number[] =>
    (params?.timestamp as string[]).map((timestamp) => Number(timestamp.slice(4).split('.')[0]));

  const fetchLogs = async (
    _requestDetails: unknown,
    _sliceCount?: number,
    params?: IContractLogsResultsParams,
    _limitOrderParams?: unknown,
  ): Promise<MirrorNodeContractLog[]> => {
    const [from, to] = blockRange(params);
    return chainLogs.filter((log) => log.block_number >= from && log.block_number <= to);
  };

  const fetchedRanges = (): number[][] =>
    mirrorNodeStub.getContractResultsLogsWithRetry.args.map(([, , params]) => blockRange(params));

  const subscribe = async (filters?: object, event = 'logs'): Promise<sinon.SinonStub> => {
    const callback = sinon.stub();
    poller.add(JSON.stringify(filters ? { event, filters } : { event }), callback);
    await clock.tickAsync(0);
    return callback;
  };

  const mine = async (...data: string[]): Promise<void> => {
    head++;
    chainLogs.push(...data.map((d, index) => log(head, d, { index })));
    await clock.tickAsync(INTERVAL);
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
    head = 100;
    chainLogs = [];

    relayImplStub = sandbox.createStubInstance(Relay);
    ethImplStub = sandbox.createStubInstance(EthImpl);
    relayImplStub.eth.returns(ethImplStub);
    ethImplStub.blockNumber.callsFake(async () => numberTo0x(head));
    ethImplStub.getBlockByNumber.callsFake(
      async (blockNumber: string, showDetails: boolean) =>
        ({ number: blockNumber, transactions: showDetails ? [pendingTx] : [pendingTx.hash] }) as unknown as Block,
    );

    mirrorNodeStub = sandbox.createStubInstance(MirrorNodeClient);
    relayImplStub.mirrorClient.returns(mirrorNodeStub);
    mirrorNodeStub.getBlock.callsFake(async (number: string | number) =>
      Number(number) <= head
        ? ({ number, timestamp: { from: `${number}.000000000`, to: `${number}.999999999` } } as MirrorNodeBlock)
        : (null as unknown as MirrorNodeBlock),
    );
    mirrorNodeStub.getContractResultsLogsWithRetry.callsFake(fetchLogs);
    mirrorNodeStub.getLimitOrderQueryParam.callsFake((limit: number, order: string) => ({ limit, order }));

    txpoolStub = sandbox.createStubInstance(TxPoolImpl);
    relayImplStub.txpool.returns(txpoolStub);
    txpoolStub.pendingTransactions.resolves([pendingTx]);

    configServiceStub = sandbox.stub(ConfigService, 'get').callThrough();
    configServiceStub.withArgs('WS_POLLING_INTERVAL').returns(INTERVAL);
    configServiceStub.withArgs('WS_NEW_HEADS_ENABLED').returns(true);

    registry = new Registry();
    poller = new PollerService(relayImplStub, logger, registry);

    const activePollsGauge = registry.getSingleMetric('rpc_websocket_active_polls') as Gauge;
    const activeNewHeadsPollsGauge = registry.getSingleMetric('rpc_websocket_active_newheads_polls') as Gauge;
    activePollsGaugeSpy = {
      inc: sandbox.spy(activePollsGauge, 'inc'),
      dec: sandbox.spy(activePollsGauge, 'dec'),
    };
    activeNewHeadsPollsGaugeSpy = {
      inc: sandbox.spy(activeNewHeadsPollsGauge, 'inc'),
      dec: sandbox.spy(activeNewHeadsPollsGauge, 'dec'),
    };

    loggerInfoSpy = sandbox.spy(logger, 'info');
  });

  afterEach(() => {
    poller.stop();
    sandbox.restore();
    clock.restore();
  });

  describe('add', () => {
    it('should add a new poll and start polling', async () => {
      const callback = sinon.stub();
      expect(poller.isPolling()).to.be.false;

      poller.add(logsTag, callback);
      await clock.tickAsync(0);
      expect(poller.hasPoll(logsTag)).to.be.true;
      expect(poller.isPolling()).to.be.true;
      expect(loggerInfoSpy.calledWith(`Poller: Tag ${logsTag} added to polling list`)).to.be.true;
      expect(loggerInfoSpy.calledWith(`Poller: Starting polling with interval=${INTERVAL}`)).to.be.true;
      expect(activePollsGaugeSpy.inc.calledOnce).to.be.true;
      expect(ethImplStub.blockNumber.calledOnce).to.be.true;
    });

    it('should add a newHeads poll', async () => {
      const callback = await subscribe({}, 'newHeads');
      await mine();
      expect(activeNewHeadsPollsGaugeSpy.inc.calledOnce).to.be.true;
      expect(callback.calledOnceWith({ number: '0x65', transactions: [pendingTx.hash], jsonrpc: '2.0' })).to.be.true;
    });

    it('should not add a poll if it already exists', () => {
      const callback = sinon.stub();
      poller.add(logsTag, callback);
      poller.add(logsTag, callback);

      expect(loggerInfoSpy.withArgs(`Poller: Tag ${logsTag} added to polling list`).calledOnce).to.be.true;
      expect(activePollsGaugeSpy.inc.calledOnce).to.be.true;
    });
  });

  describe('remove', () => {
    it('should remove an existing poll and stop polling if no polls are left', () => {
      const callback = sinon.stub();
      poller.add(logsTag, callback);
      expect(poller.hasPoll(logsTag)).to.be.true;

      poller.remove(logsTag);

      expect(poller.hasPoll(logsTag)).to.be.false;
      expect(poller.isPolling()).to.be.false;
      expect(loggerInfoSpy.calledWith(`Poller: Tag ${logsTag} removed from polling list`)).to.be.true;
      expect(loggerInfoSpy.calledWith('Poller: No active polls.')).to.be.true;
      expect(loggerInfoSpy.calledWith('Poller: Stopping polling')).to.be.true;
      expect(activePollsGaugeSpy.dec.calledWith(1)).to.be.true;
    });

    it('should remove a newHeads poll', () => {
      const callback = sinon.stub();
      poller.add(newHeadsTag, callback);
      poller.remove(newHeadsTag);
      expect(activeNewHeadsPollsGaugeSpy.dec.calledWith(1)).to.be.true;
    });

    it('should not stop polling if other polls exist', () => {
      const callback = sinon.stub();
      poller.add(logsTag, callback);
      poller.add(newHeadsTag, callback);

      poller.remove(logsTag);

      expect(poller.isPolling()).to.be.true;
    });
  });

  describe('log matching', () => {
    beforeEach(() => {
      chainLogs = [
        log(101, '0x01'),
        log(101, '0x02', {
          address: OTHER_LONG_ZERO,
          contract_id: '0.0.1002',
          index: 1,
          topics: [APPROVAL, pad('0x0'), pad('0x208fa13')],
        }),
        log(101, '0x03', { index: 2, topics: [TRANSFER, pad('0x5'), pad('0x208fa13')] }),
        log(101, '0x04', { index: 3, topics: [] }),
      ];
    });

    const matched = async (filters: object): Promise<string[]> => {
      head = 100;
      const callback = await subscribe(filters);
      head++;
      await clock.tickAsync(INTERVAL);
      poller.remove(JSON.stringify({ event: 'logs', filters }));
      return sent(callback);
    };

    it('should match a contract by its EVM address in any case', async () => {
      expect(await matched({ address: EVM_ADDRESS })).to.deep.equal(['0x01', '0x03', '0x04']);
      expect(await matched({ address: EVM_ADDRESS.toLowerCase() })).to.deep.equal(['0x01', '0x03', '0x04']);
    });

    it('should match a contract by its long-zero address, with or without an EVM address', async () => {
      expect(await matched({ address: LONG_ZERO })).to.deep.equal(['0x01', '0x03', '0x04']);
      expect(await matched({ address: OTHER_LONG_ZERO })).to.deep.equal(['0x02']);
    });

    it('should match any address in a list', async () => {
      expect(await matched({ address: [OTHER_LONG_ZERO, LONG_ZERO] })).to.deep.equal(['0x01', '0x02', '0x03', '0x04']);
    });

    it('should match every address when there is no address or the list is empty', async () => {
      expect(await matched({ address: [] })).to.deep.equal(['0x01', '0x02', '0x03', '0x04']);
      expect(await matched({ topics: [] })).to.deep.equal(['0x01', '0x02', '0x03', '0x04']);
    });

    it('should match nothing for an unknown address', async () => {
      expect(await matched({ address: `0x${'1'.repeat(40)}` })).to.deep.equal([]);
    });

    it('should match a topic at its position', async () => {
      expect(await matched({ topics: [TRANSFER] })).to.deep.equal(['0x01', '0x03']);
      expect(await matched({ topics: [null, pad('0x5')] })).to.deep.equal(['0x03']);
    });

    it('should match any topic in an OR list', async () => {
      expect(await matched({ topics: [[TRANSFER, APPROVAL]] })).to.deep.equal(['0x01', '0x02', '0x03']);
    });

    it('should match any topic at a null or empty position, or one whose OR list holds a null', async () => {
      expect(await matched({ topics: [null, pad('0x0')] })).to.deep.equal(['0x02']);
      expect(await matched({ topics: [[], pad('0x0')] })).to.deep.equal(['0x02']);
      expect(await matched({ topics: [[TRANSFER, null], pad('0x0')] })).to.deep.equal(['0x02']);
    });

    it('should compare topics without their leading zeros and in any case', async () => {
      expect(await matched({ topics: [null, null, '0x208FA13'] })).to.deep.equal(['0x02', '0x03']);
      expect(await matched({ topics: [null, '0x0'] })).to.deep.equal(['0x02']);
    });

    it('should match a log with fewer topics when the positions past them are null, as the Mirror Node does', async () => {
      expect(await matched({ topics: [TRANSFER, null, null] })).to.deep.equal(['0x01', '0x03']);
    });

    it('should match on both address and topics', async () => {
      expect(await matched({ address: LONG_ZERO, topics: [TRANSFER, null, pad('0x208fa13')] })).to.deep.equal(['0x03']);
    });
  });

  describe('on recorded mainnet Mirror Node responses', () => {
    const key = (timestamp: string, index: number): string => `${timestamp}/${index}`;
    const recordedLogs = new Map(recorded.logs.map((log) => [key(log.timestamp, log.index), log]));

    const sendRecorded = async (filters: object[]): Promise<sinon.SinonStub[]> => {
      head = recorded.fromBlock - 1;
      chainLogs = recorded.logs;
      const callbacks: sinon.SinonStub[] = [];
      for (const filter of filters) {
        callbacks.push(await subscribe(filter));
      }
      head = recorded.toBlock;
      await clock.tickAsync(INTERVAL * 2);
      return callbacks;
    };

    it('should send each filter the logs the Mirror Node matched for it, in the order they happened', async () => {
      const callbacks = await sendRecorded(recorded.filters.map(({ filters }) => filters));

      recorded.filters.forEach(({ mirrorNodeMatches }, i) => {
        const expected = mirrorNodeMatches
          .map(([timestamp, index]) => recordedLogs.get(key(timestamp as string, index as number))!)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.index - b.index)
          .map((log) => Log.fromMirrorNodeContractLog(log));
        expect(callbacks[i].args.map(([log]) => log)).to.deep.equal(expected);
      });
    });

    it('should match an all-zero topic, which the Mirror Node never matches', async () => {
      const [callback] = await sendRecorded([recorded.zeroTopicFilter.filters]);

      const expected = recorded.logs
        .filter((log) => /^0x0{64}$/.test(log.topics[2] ?? ''))
        .map((log) => Log.fromMirrorNodeContractLog(log));
      expect(recorded.zeroTopicFilter.mirrorNodeMatches).to.be.empty;
      expect(expected).to.have.lengthOf(2);
      expect(callback.args.map(([log]) => log)).to.deep.equal(expected);
    });
  });

  describe('logs', () => {
    it('should start from the latest block, so logs from earlier blocks are not sent', async () => {
      chainLogs.push(log(100, '0x01'));
      const callback = await subscribe();
      await mine('0x02');

      expect(sent(callback)).to.deep.equal(['0x02']);
      expect(fetchedRanges()).to.deep.equal([[101, 101]]);
    });

    it('should fetch a block range once with one unfiltered ascending query, however many subscribers', async () => {
      const callbacks = [await subscribe({ address: EVM_ADDRESS }), await subscribe({ topics: [TRANSFER] })];
      await mine('0x01');

      expect(mirrorNodeStub.getContractResultsLogsWithRetry.calledOnce).to.be.true;
      expect(mirrorNodeStub.getContractResultsLogsWithRetry.firstCall.args.slice(1)).to.deep.equal([
        1,
        { timestamp: ['gte:101.000000000', 'lte:101.999999999'] },
        { limit: ConfigService.get('MIRROR_NODE_LIMIT_PARAM'), order: 'asc' },
      ]);
      callbacks.forEach((callback) => expect(sent(callback)).to.deep.equal(['0x01']));
    });

    it('should do nothing else while the latest block is unchanged', async () => {
      await subscribe();
      await subscribe({}, 'newHeads');
      await clock.tickAsync(INTERVAL * 3);

      expect(ethImplStub.blockNumber.callCount).to.equal(4);
      expect(mirrorNodeStub.getBlock.called).to.be.false;
      expect(mirrorNodeStub.getContractResultsLogsWithRetry.called).to.be.false;
      expect(ethImplStub.getBlockByNumber.called).to.be.false;
    });

    it('should catch up on missed blocks in small batches, without waiting for the interval', async () => {
      const callback = await subscribe();
      const blocks = Array.from({ length: 25 }, (_, i) => head + i + 1);
      chainLogs.push(...blocks.map((block) => log(block, numberTo0x(block))));
      head += 25;
      await clock.tickAsync(INTERVAL * 1.5);

      expect(fetchedRanges()).to.deep.equal([
        [101, 110],
        [111, 120],
        [121, 125],
      ]);
      expect(sent(callback)).to.deep.equal(blocks.map((block) => numberTo0x(block)));
    });

    it('should fetch fewer blocks at once when a range has too many logs for one query', async () => {
      mirrorNodeStub.getContractResultsLogsWithRetry.callsFake(async (...args) => {
        const [from, to] = blockRange(args[2]);
        if (to - from >= 5) {
          throw predefined.PAGINATION_MAX(200);
        }
        return fetchLogs(...args);
      });
      const callback = await subscribe();
      const blocks = Array.from({ length: 10 }, (_, i) => head + i + 1);
      chainLogs.push(...blocks.map((block) => log(block, numberTo0x(block))));
      head += 10;
      await clock.tickAsync(INTERVAL * 1.5);

      expect(fetchedRanges()).to.deep.equal([
        [101, 110],
        [101, 105],
        [106, 110],
      ]);
      expect(sent(callback)).to.deep.equal(blocks.map((block) => numberTo0x(block)));
    });

    it('should not fetch logs when nobody subscribes to logs', async () => {
      await subscribe({}, 'newHeads');
      await mine('0x01');

      expect(mirrorNodeStub.getBlock.called).to.be.false;
      expect(mirrorNodeStub.getContractResultsLogsWithRetry.called).to.be.false;
    });

    it('should send nothing from blocks handled before a logs subscriber joined', async () => {
      await subscribe({}, 'newHeads');
      await mine('0x01');
      const callback = await subscribe();
      await mine('0x02');

      expect(sent(callback)).to.deep.equal(['0x02']);
    });

    it('should send the first block that arrives after a logs subscriber joins a running loop', async () => {
      await subscribe({ includeTransactions: false }, 'newPendingTransactions');
      await clock.tickAsync(INTERVAL);
      const callback = await subscribe();
      await mine('0x01');

      expect(sent(callback)).to.deep.equal(['0x01']);
    });
  });

  describe('newHeads', () => {
    it('should build the head once per includeTransactions value and send it to every subscriber', async () => {
      const callbacks = [
        await subscribe({}, 'newHeads'),
        await subscribe({ includeTransactions: false }, 'newHeads'),
        await subscribe({ includeTransactions: true }, 'newHeads'),
      ];
      await mine();

      expect(ethImplStub.getBlockByNumber.args.map(([number, showDetails]) => [number, showDetails])).to.deep.equal([
        ['0x65', false],
        ['0x65', true],
      ]);
      expect(callbacks[0].calledOnceWith({ number: '0x65', transactions: [pendingTx.hash], jsonrpc: '2.0' })).to.be
        .true;
      expect(callbacks[1].calledOnceWith({ number: '0x65', transactions: [pendingTx.hash], jsonrpc: '2.0' })).to.be
        .true;
      expect(callbacks[2].calledOnceWith({ number: '0x65', transactions: [pendingTx], jsonrpc: '2.0' })).to.be.true;
    });

    it('should send a head only when the latest block changes, starting with the next block', async () => {
      const callback = await subscribe({}, 'newHeads');
      await clock.tickAsync(INTERVAL * 2);
      expect(callback.called).to.be.false;

      head += 2;
      await clock.tickAsync(INTERVAL * 2);
      expect(callback.args.map(([block]) => (block as Block).number)).to.deep.equal(['0x66']);
    });

    it("should send a block's head before its logs", async () => {
      const logsCallback = await subscribe();
      const newHeadsCallback = await subscribe({}, 'newHeads');
      await mine('0x01');

      expect(sent(logsCallback)).to.deep.equal(['0x01']);
      expect(newHeadsCallback.calledBefore(logsCallback)).to.be.true;
    });

    it('should skip the notification when no block is returned and retry on the next poll', async () => {
      const loggerWarnSpy = sandbox.spy(logger, 'warn');
      ethImplStub.getBlockByNumber.onFirstCall().resolves(null);
      const callback = await subscribe({}, 'newHeads');
      await mine();

      expect(callback.called).to.be.false;
      expect(loggerWarnSpy.calledWith('Poller: No block returned for block 101, skipping notification')).to.be.true;

      await clock.tickAsync(INTERVAL);
      expect(callback.calledOnceWith({ number: '0x65', transactions: [pendingTx.hash], jsonrpc: '2.0' })).to.be.true;
    });

    it('should not send heads when newHeads are disabled', async () => {
      configServiceStub.withArgs('WS_NEW_HEADS_ENABLED').returns(false);
      const callback = await subscribe({}, 'newHeads');
      await mine();

      expect(ethImplStub.getBlockByNumber.called).to.be.false;
      expect(callback.called).to.be.false;
    });
  });

  describe('newPendingTransactions', () => {
    it('should poll the transaction pool for newPendingTransactions hashes or full transactions', async () => {
      const hashesCallback = sinon.stub();
      const transactionsCallback = sinon.stub();
      poller.add('{"event":"newPendingTransactions","filters":{"includeTransactions":false}}', hashesCallback);
      poller.add('{"event":"newPendingTransactions","filters":{"includeTransactions":true}}', transactionsCallback);
      await clock.tickAsync(2000);

      expect(hashesCallback.calledWith(pendingTx.hash)).to.be.true;
      expect(transactionsCallback.calledWith(pendingTx)).to.be.true;
      expect(txpoolStub.pendingTransactions.callCount).to.equal(3);
    });

    it('should send each pending transaction once while it stays in the pool', async () => {
      const callback = sinon.stub();
      poller.add('{"event":"newPendingTransactions","filters":{"includeTransactions":false}}', callback);
      await clock.tickAsync(2000);
      txpoolStub.pendingTransactions.resolves([pendingTx, { hash: '0xdef' } as TxPoolTransaction]);
      await clock.tickAsync(1000);

      expect(callback.args).to.deep.equal([[pendingTx.hash], ['0xdef']]);
    });
  });

  describe('errors', () => {
    it('should retry a failed poll with a growing delay, up to a cap', async () => {
      const attempts: number[] = [];
      mirrorNodeStub.getContractResultsLogsWithRetry.callsFake(async () => {
        attempts.push(clock.now);
        throw new Error('Mirror Node is down');
      });
      await subscribe();
      head++;
      await clock.tickAsync(35000);

      expect(attempts).to.deep.equal([1000, 3000, 7000, 15000, 25000, 35000]);
    });

    it('should send a failed block once it recovers, then poll at the normal interval again', async () => {
      mirrorNodeStub.getContractResultsLogsWithRetry.onFirstCall().rejects(new Error('Mirror Node is down'));
      const callback = await subscribe();
      await mine('0x01');
      expect(callback.called).to.be.false;

      await clock.tickAsync(INTERVAL * 2);
      expect(sent(callback)).to.deep.equal(['0x01']);

      await mine('0x02');
      expect(sent(callback)).to.deep.equal(['0x01', '0x02']);
    });

    it('should retry when the Mirror Node reports a block it cannot return yet', async () => {
      mirrorNodeStub.getBlock.onFirstCall().resolves(null as unknown as MirrorNodeBlock);
      const callback = await subscribe();
      await mine('0x01');
      expect(callback.called).to.be.false;
      expect(mirrorNodeStub.getContractResultsLogsWithRetry.called).to.be.false;

      await clock.tickAsync(INTERVAL * 2);
      expect(sent(callback)).to.deep.equal(['0x01']);
    });

    it('should send nothing from a poll that fails part way', async () => {
      ethImplStub.getBlockByNumber.onFirstCall().rejects(new Error('Mirror Node is down'));
      const logsCallback = await subscribe();
      const newHeadsCallback = await subscribe({}, 'newHeads');
      await mine('0x01');
      expect(logsCallback.called).to.be.false;
      expect(newHeadsCallback.called).to.be.false;

      await clock.tickAsync(INTERVAL * 2);
      expect(sent(logsCallback)).to.deep.equal(['0x01']);
      expect(newHeadsCallback.calledOnce).to.be.true;
    });

    it('should keep polling blocks when the transaction pool fails', async () => {
      txpoolStub.pendingTransactions.rejects(new Error('Pool is down'));
      await subscribe({ includeTransactions: false }, 'newPendingTransactions');
      const callback = await subscribe();
      await mine('0x01');

      expect(sent(callback)).to.deep.equal(['0x01']);
    });
  });

  describe('metrics', () => {
    const LAG = 'rpc_websocket_poller_lag_blocks';
    const FAILED_POLLS = 'rpc_websocket_poller_failed_polls_total';
    const value = async (name: string): Promise<number> =>
      (await (registry.getSingleMetric(name) as Gauge | Counter).get()).values[0].value;

    it('should report how far behind the loop is while it catches up', async () => {
      const lagSpy = sandbox.spy(registry.getSingleMetric(LAG) as Gauge, 'set');
      await subscribe();
      head += 25;
      await clock.tickAsync(INTERVAL * 1.5);

      expect(lagSpy.args).to.deep.equal([[25], [15], [15], [5], [5], [0]]);
    });

    it('should count failed polls and keep the lag growing while fetching logs fails', async () => {
      mirrorNodeStub.getContractResultsLogsWithRetry.rejects(new Error('Mirror Node is down'));
      await subscribe();
      head += 3;
      await clock.tickAsync(INTERVAL);
      head += 2;
      await clock.tickAsync(INTERVAL * 2);

      expect(await value(LAG)).to.equal(5);
      expect(await value(FAILED_POLLS)).to.equal(2);
    });

    it('should reset the lag when polling stops, even with a poll still in flight', async () => {
      mirrorNodeStub.getContractResultsLogsWithRetry.rejects(new Error('Mirror Node is down'));
      await subscribe();
      head += 3;
      await clock.tickAsync(INTERVAL);
      expect(await value(LAG)).to.equal(3);

      ethImplStub.blockNumber.callsFake(async () => {
        await sleep(500);
        return numberTo0x(head);
      });
      await clock.tickAsync(INTERVAL * 2);
      poller.remove('{"event":"logs"}');
      await clock.tickAsync(500);

      expect(await value(LAG)).to.equal(0);
    });
  });

  describe('start/stop', () => {
    it('should never start a poll before the previous one finishes', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      ethImplStub.blockNumber.callsFake(async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await sleep(2500);
        inFlight--;
        return numberTo0x(head);
      });
      await subscribe();
      await clock.tickAsync(10000);

      expect(maxInFlight).to.equal(1);
      // Each poll takes 2.5s and the next one starts 1s after it ends: at 0s, 3.5s and 7s.
      expect(ethImplStub.blockNumber.callCount).to.equal(3);
    });

    it('should ignore a poll still in flight when polling restarts', async () => {
      mirrorNodeStub.getContractResultsLogsWithRetry.callsFake(async (...args) => {
        await sleep(500);
        return fetchLogs(...args);
      });
      const first = await subscribe();
      head++;
      chainLogs.push(log(101, '0x01'));
      await clock.tickAsync(INTERVAL);

      poller.remove('{"event":"logs"}');
      const second = await subscribe();
      await clock.tickAsync(500);
      expect(first.called).to.be.false;
      expect(second.called).to.be.false;

      await mine('0x02');
      await clock.tickAsync(INTERVAL);
      expect(sent(second)).to.deep.equal(['0x02']);
    });

    it('should start again from the latest block after the last subscription is removed', async () => {
      await subscribe();
      poller.remove('{"event":"logs"}');
      head += 2;
      chainLogs.push(log(101, '0x01'), log(102, '0x02'));
      const callback = await subscribe();
      await mine('0x03');

      expect(sent(callback)).to.deep.equal(['0x03']);
    });

    it('stop does nothing if not polling', () => {
      expect(poller.isPolling()).to.be.false;
      const clearTimeoutSpy = sandbox.spy(global, 'clearTimeout');
      poller.stop();
      expect(clearTimeoutSpy.notCalled).to.be.true;
    });
  });
});
