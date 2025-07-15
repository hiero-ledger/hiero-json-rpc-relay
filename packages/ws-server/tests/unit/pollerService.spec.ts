// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Relay } from '@hashgraph/json-rpc-relay';
import { EthImpl } from '@hashgraph/json-rpc-relay/dist/lib/eth';
import { expect } from 'chai';
import pino from 'pino';
import { Gauge } from 'prom-client';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { PollerService } from '../../src/service/pollerService';

const logger = pino({ level: 'trace' });

describe('PollerService', async function () {
  const logs =
    '[{"address":"0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69","blockHash":"0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b","blockNumber":"0x3","data":"0x","logIndex":"0x0","removed":false,"topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x0000000000000000000000000000000000000000000000000000000000000000","0x000000000000000000000000000000000000000000000000000000000208fa13","0x0000000000000000000000000000000000000000000000000000000000000005"],"transactionHash":"0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392","transactionIndex":"0x1"}]';
  const logsArray = JSON.parse(logs);
  const logsTag =
    '{"event":"logs","filters":{"address":"0x23f5e49569A835d7bf9AefD30e4f60CdD570f225","topics":["0xc8b501cbd8e69c98c535894661d25839eb035b096adfde2bba416f04cc7ce987"]}}';
  const newHeadsTag = '{"event":"newHeads","filters":{}}';
  const mockBlock: any = {
    number: 1,
    hash: '0x123',
    parentHash: '0x',
    nonce: '0x',
    sha3Uncles: '0x',
    logsBloom: '0x',
    transactionsRoot: '0x',
    stateRoot: '0x',
    receiptsRoot: '0x',
    miner: '0x',
    difficulty: '0x',
    totalDifficulty: '0x',
    extraData: '0x',
    size: '0x',
    gasLimit: '0x',
    gasUsed: '0x',
    timestamp: 12345,
    transactions: [],
    baseFeePerGas: '0x',
  };

  let relayImplStub: sinon.SinonStubbedInstance<Relay>;
  let ethImplStub: sinon.SinonStubbedInstance<EthImpl>;
  let poller: PollerService;
  let pollSpy: sinon.SinonSpy;
  let sandbox: sinon.SinonSandbox;
  let loggerInfoSpy: sinon.SinonSpy;
  let clock: sinon.SinonFakeTimers;
  let configServiceStub;
  let activePollsGauge: Gauge;
  let activeNewHeadsPollsGauge: Gauge;
  let activePollsGaugeSpy;
  let activeNewHeadsPollsGaugeSpy;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();

    relayImplStub = sandbox.createStubInstance(Relay);
    ethImplStub = sandbox.createStubInstance(EthImpl);
    relayImplStub.eth.returns(ethImplStub);
    ethImplStub.blockNumber.resolves('0x1b177b');
    ethImplStub.getLogs.resolves(logsArray);
    ethImplStub.getBlockByNumber.resolves(mockBlock);

    configServiceStub = sandbox.stub(ConfigService, 'get');
    configServiceStub.withArgs('WS_POLLING_INTERVAL').returns(1000);
    configServiceStub.withArgs('WS_NEW_HEADS_ENABLED').returns(true);

    const registry = new Registry();
    poller = new PollerService(relayImplStub, logger, registry);

    activePollsGauge = registry.getSingleMetric('rpc_websocket_active_polls') as Gauge;
    activeNewHeadsPollsGauge = registry.getSingleMetric('rpc_websocket_active_newheads_polls') as Gauge;
    activePollsGaugeSpy = {
      inc: sandbox.spy(activePollsGauge, 'inc'),
      dec: sandbox.spy(activePollsGauge, 'dec'),
    };
    activeNewHeadsPollsGaugeSpy = {
      inc: sandbox.spy(activeNewHeadsPollsGauge, 'inc'),
      dec: sandbox.spy(activeNewHeadsPollsGauge, 'dec'),
    };

    loggerInfoSpy = sandbox.spy(logger, 'info');
    pollSpy = sandbox.spy(poller, 'poll');
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
      await clock.tickAsync(2000);
      expect(poller.hasPoll(logsTag)).to.be.true;
      expect(poller.isPolling()).to.be.true;
      expect(loggerInfoSpy.calledWith(`Poller: Tag ${logsTag} added to polling list`)).to.be.true;
      expect(loggerInfoSpy.calledWith(`Poller: Starting polling with interval=1000`)).to.be.true;
      expect(activePollsGaugeSpy.inc.calledOnce).to.be.true;
      expect(pollSpy.called).to.be.true;
      expect(
        ethImplStub.getLogs.calledWith({
          blockHash: null,
          fromBlock: '0x1b177b',
          toBlock: 'latest',
          address: '0x23f5e49569A835d7bf9AefD30e4f60CdD570f225',
          topics: ['0xc8b501cbd8e69c98c535894661d25839eb035b096adfde2bba416f04cc7ce987'],
        }),
      ).to.be.true;
    });

    it('should add a newHeads poll', async () => {
      const callback = sinon.stub();
      poller.add(newHeadsTag, callback);
      await clock.tickAsync(2000);
      expect(activeNewHeadsPollsGaugeSpy.inc.calledOnce).to.be.true;
      expect(ethImplStub.getBlockByNumber.calledWith('latest', false)).to.be.true;
    });

    it('should not add a poll if it already exists', () => {
      const callback = sinon.stub();
      poller.add(logsTag, callback); // first add

      poller.add(logsTag, callback); // second add

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

  describe('start/stop', () => {
    it('should start and stop polling via timers', async () => {
      const callback = sinon.stub();
      poller.add(logsTag, callback);
      expect(poller.isPolling()).to.be.true;

      await clock.tickAsync(1000);
      expect(ethImplStub.blockNumber.calledOnce).to.be.true;
      expect(pollSpy.calledOnce).to.be.true;

      await clock.tickAsync(1000);
      expect(ethImplStub.blockNumber.calledTwice).to.be.true;
      expect(pollSpy.calledTwice).to.be.true;

      poller.stop();
      expect(poller.isPolling()).to.be.false;

      await clock.tickAsync(1000);
      expect(pollSpy.calledTwice).to.be.true;
    });

    it('stop does nothing if not polling', () => {
      expect(poller.isPolling()).to.be.false;
      const clearIntervalSpy = sandbox.spy(global, 'clearInterval');
      poller.stop();
      expect(clearIntervalSpy.notCalled).to.be.true;
    });
  });
});
