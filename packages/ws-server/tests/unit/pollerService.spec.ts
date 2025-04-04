// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Relay } from '@hashgraph/json-rpc-relay';
import { EthImpl } from '@hashgraph/json-rpc-relay/src/lib/eth';
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { PollerService } from '../../src/service/pollerService';

const logger = pino({ level: 'trace' });

describe('Polling', async function () {
  this.timeout(20000);

  const ARRAY_OF_LOGS = 'Called notifySubscriber with an array of log data!';
  const FETCHING_DATA =
    'Poller: Fetching data for tag: {"event":"logs","filters":{"address":"0x23f5e49569A835d7bf9AefD30e4f60CdD570f225","topics":["0xc8b501cbd8e69c98c535894661d25839eb035b096adfde2bba416f04cc7ce987"]}}';
  const logs =
    '[{"address":"0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69","blockHash":"0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b","blockNumber":"0x3","data":"0x","logIndex":"0x0","removed":false,"topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x0000000000000000000000000000000000000000000000000000000000000000","0x000000000000000000000000000000000000000000000000000000000208fa13","0x0000000000000000000000000000000000000000000000000000000000000005"],"transactionHash":"0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392","transactionIndex":"0x1"},{"address":"0x0000000000000000000000000000000002131952","blockHash":"0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b","blockNumber":"0x3","data":"0x","logIndex":"0x1","removed":false,"topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x0000000000000000000000000000000000000000000000000000000000000000","0x000000000000000000000000000000000000000000000000000000000208fa13","0x0000000000000000000000000000000000000000000000000000000000000005"],"transactionHash":"0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392","transactionIndex":"0x1"},{"address":"0x0000000000000000000000000000000002131953","blockHash":"0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b","blockNumber":"0x4","data":"0x","logIndex":"0x0","removed":false,"topics":[],"transactionHash":"0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6393","transactionIndex":"0x1"},{"address":"0x0000000000000000000000000000000002131954","blockHash":"0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b","blockNumber":"0x5","data":"0x","logIndex":"0x0","removed":false,"topics":[],"transactionHash":"0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6394","transactionIndex":"0x1"}]';
  const logsArray = [
    {
      address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x3',
      data: '0x',
      logIndex: '0x0',
      removed: false,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x000000000000000000000000000000000000000000000000000000000208fa13',
        '0x0000000000000000000000000000000000000000000000000000000000000005',
      ],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392',
      transactionIndex: '0x1',
    },
    {
      address: '0x0000000000000000000000000000000002131952',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x3',
      data: '0x',
      logIndex: '0x1',
      removed: false,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x000000000000000000000000000000000000000000000000000000000208fa13',
        '0x0000000000000000000000000000000000000000000000000000000000000005',
      ],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392',
      transactionIndex: '0x1',
    },
    {
      address: '0x0000000000000000000000000000000002131953',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x4',
      data: '0x',
      logIndex: '0x0',
      removed: false,
      topics: [],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6393',
      transactionIndex: '0x1',
    },
    {
      address: '0x0000000000000000000000000000000002131954',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x5',
      data: '0x',
      logIndex: '0x0',
      removed: false,
      topics: [],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6394',
      transactionIndex: '0x1',
    },
    {
      address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x3',
      data: '0x',
      logIndex: '0x0',
      removed: false,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x000000000000000000000000000000000000000000000000000000000208fa13',
        '0x0000000000000000000000000000000000000000000000000000000000000005',
      ],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392',
      transactionIndex: '0x1',
    },
    {
      address: '0x0000000000000000000000000000000002131952',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x3',
      data: '0x',
      logIndex: '0x1',
      removed: false,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x000000000000000000000000000000000000000000000000000000000208fa13',
        '0x0000000000000000000000000000000000000000000000000000000000000005',
      ],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392',
      transactionIndex: '0x1',
    },
    {
      address: '0x0000000000000000000000000000000002131953',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x4',
      data: '0x',
      logIndex: '0x0',
      removed: false,
      topics: [],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6393',
      transactionIndex: '0x1',
    },
    {
      address: '0x0000000000000000000000000000000002131954',
      blockHash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b',
      blockNumber: '0x5',
      data: '0x',
      logIndex: '0x0',
      removed: false,
      topics: [],
      transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6394',
      transactionIndex: '0x1',
    },
  ];
  const SINGLE_LINE = 'Called notifySubscriber with single line of log data!';
  const tag =
    '{"event":"logs","filters":{"address":"0x23f5e49569A835d7bf9AefD30e4f60CdD570f225","topics":["0xc8b501cbd8e69c98c535894661d25839eb035b096adfde2bba416f04cc7ce987"]}}';

  let relayImplStub: sinon.SinonStubbedInstance<Relay>;
  let ethImplStub: sinon.SinonStubbedInstance<EthImpl>;
  let poller: PollerService;
  let sandbox: sinon.SinonSandbox;

  this.beforeEach(() => {
    relayImplStub = sinon.createStubInstance(Relay);
    ethImplStub = sinon.createStubInstance(EthImpl);
    relayImplStub.eth.returns(ethImplStub);
    ethImplStub.blockNumber.resolves('0x1b177b');
    ethImplStub.getLogs.resolves(JSON.parse(logs));

    const registry = new Registry();
    poller = new PollerService(relayImplStub, logger, registry);
    sandbox = sinon.createSandbox();
  });

  this.afterEach(() => {
    sandbox.restore();
  });

  describe('Poller', () => {
    it('should start polling', async () => {
      ethImplStub.blockNumber.resolves('0x1b177b');
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const notifySubscriber = (tag, logs) => {};
      ethImplStub.getLogs.resolves(JSON.parse(logs));
      const loggerSpy = sandbox.spy(logger, 'info');

      expect(poller.hasPoll(tag)).to.be.false;
      await poller.add(tag, notifySubscriber);
      expect(poller.hasPoll(tag)).to.be.true;

      expect(loggerSpy.calledTwice).to.be.true;
      expect(
        loggerSpy.calledWith(
          'Poller: Tag {"event":"logs","filters":{"address":"0x23f5e49569A835d7bf9AefD30e4f60CdD570f225","topics":["0xc8b501cbd8e69c98c535894661d25839eb035b096adfde2bba416f04cc7ce987"]}} added to polling list',
        ),
      ).to.equal(true);
      expect(
        loggerSpy.calledWith(`Poller: Starting polling with interval=${ConfigService.get('WS_POLLING_INTERVAL')}`),
      ).to.equal(true);
      loggerSpy.restore();
    });

    it('should stop polling', () => {
      const loggerSpy = sandbox.spy(logger, 'info');
      poller.remove(tag);

      expect(poller.isPolling()).to.be.false;
      expect(
        loggerSpy.calledWith(
          'Poller: Tag {"event":"logs","filters":{"address":"0x23f5e49569A835d7bf9AefD30e4f60CdD570f225","topics":["0xc8b501cbd8e69c98c535894661d25839eb035b096adfde2bba416f04cc7ce987"]}} removed from polling list',
        ),
      ).to.equal(true);
      expect(loggerSpy.calledWith('Poller: No active polls.')).to.equal(true);
      expect(loggerSpy.calledWith('Poller: Stopping polling')).to.equal(true);
      loggerSpy.restore();
    });

    it('should poll single line of log data', async () => {
      const notifySubscriber = (data) => {
        if (logger.isLevelEnabled('debug')) {
          logger.debug(SINGLE_LINE);
        }
        expect(data).to.eq(logs);
        return;
      };

      ethImplStub.getLogs.resolves(JSON.parse(logs));

      poller.add(tag, notifySubscriber);
      const loggerSpy = sandbox.spy(logger, 'debug');
      const poll = async () => {
        poller.poll();

        expect(loggerSpy.callCount).to.equal(1);
        expect(loggerSpy.getCall(0).args[0]).to.equal(FETCHING_DATA);
      };

      await poll();
      expect(loggerSpy.getCall(1).args[0]).to.equal(SINGLE_LINE);
      loggerSpy.restore();
    });

    it('should poll an array of log data', async () => {
      const notifySubscriber = (data) => {
        if (logger.isLevelEnabled('debug')) {
          logger.debug(ARRAY_OF_LOGS);
        }
        expect(data).to.deep.eq(logsArray);
        return;
      };

      ethImplStub.getLogs.resolves(logsArray);

      poller.add(tag, notifySubscriber);
      const loggerSpy = sandbox.spy(logger, 'debug');
      const poll = async () => {
        poller.poll();

        expect(loggerSpy.callCount).to.equal(1);
        expect(loggerSpy.getCall(0).args[0]).to.equal(FETCHING_DATA);
      };

      await poll();
      expect(loggerSpy.getCall(1).args[0]).to.equal(ARRAY_OF_LOGS);
      loggerSpy.restore();
    });
  });
});
