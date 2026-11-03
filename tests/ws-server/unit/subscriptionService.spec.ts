// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { JsonRpcError, predefined, Relay } from '../../../src/relay';
import { IPRateLimiterService } from '../../../src/relay/lib/services';
import ConnectionLimiter from '../../../src/ws-server/metrics/connectionLimiter';
import { type PollerService } from '../../../src/ws-server/service/pollerService';
import { SubscriptionService } from '../../../src/ws-server/service/subscriptionService';
import type { RelayWebSocket } from '../../../src/ws-server/types';
import { overrideEnvsInMochaDescribe } from '../../relay/helpers';

const logger = pino({ level: 'trace' });
const register = new Registry();
const limiter = new ConnectionLimiter(logger, register, sinon.createStubInstance(IPRateLimiterService));
let relay: sinon.SinonStubbedInstance<Relay>;

class MockWsConnection {
  id: string;
  limiter: ConnectionLimiter;
  subscriptions = 0;

  constructor(id: string) {
    this.id = id;
    this.limiter = limiter;
  }

  send(msg: string): void {
    console.log(`Mocked ws-connection with id: ${this.id} used method: send(${msg}`);
  }
}

// The service only touches `id`, `limiter`, `subscriptions` and `send` on a connection, so the minimal stand-in above is enough.
const mockWsConnection = (id: string): RelayWebSocket => new MockWsConnection(id) as unknown as RelayWebSocket;

interface SubscriptionServiceInternals {
  createHash(data: string): string;
  pollerService: PollerService;
}

describe('subscriptionService', async function () {
  this.timeout(20000);
  let subscriptionService: SubscriptionService;
  let sandbox: sinon.SinonSandbox;
  this.beforeAll(() => {
    // @ts-ignore
    relay = sinon.createStubInstance(Relay);
    const registry = new Registry();

    subscriptionService = new SubscriptionService(relay, logger, registry);
  });

  this.beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  this.afterEach(() => {
    sandbox.restore();
  });

  it('Should create sha256 hash out of a data object', async function () {
    const dataToHash = 'This is a Test';

    const hash = (subscriptionService as unknown as SubscriptionServiceInternals).createHash(dataToHash);

    expect(hash).to.be.eq(`401b022b962452749726ba96d436921e39d6deb2b0f4a922cc3da5d7e99e6e46`);
  });

  it('generateId should create a random hex ID, with 34 length', async function () {
    const generatedId = subscriptionService.generateId();

    expect(generatedId).to.be.length(34);
    expect(generatedId.substring(0, 2)).to.be.eq('0x');
  });

  it('generatedId should be unique', async () => {
    const generatedId = subscriptionService.generateId();
    const generatedId2 = subscriptionService.generateId();

    expect(generatedId).not.to.be.eq(generatedId2);
    expect(generatedId.substring(0, 2)).to.be.eq('0x');
    expect(generatedId2.substring(0, 2)).to.be.eq('0x');
  });

  it('when subscribing should return subId and poller should add(tag)', async function () {
    const connectionId = '1';
    const wsConnection = mockWsConnection(connectionId);
    const spy = sandbox.spy((subscriptionService as unknown as SubscriptionServiceInternals).pollerService, 'add');

    const subId = subscriptionService.subscribe(wsConnection, 'logs');

    expect(spy.getCall(0).args[0]).to.be.eq(`{"event":"logs"}`);
    expect(subId).to.be.length(34);

    subscriptionService.unsubscribe(wsConnection, subId);
  });

  it('notifySubscribers should notify subscribers with data', async function () {
    const connectionId = '2';
    const wsConnection = mockWsConnection(connectionId);
    const subId = subscriptionService.subscribe(wsConnection, 'logs');
    const spy = sandbox.spy(wsConnection, 'send');
    const testData = 'test example data';

    subscriptionService.notifySubscribers(`{"event":"logs"}`, testData);

    expect(spy.getCall(0).args[0]).to.be.eq(
      `{"jsonrpc":"2.0","method":"eth_subscription","params":{"result":"${testData}","subscription":"${subId}"}}`,
    );

    subscriptionService.unsubscribe(wsConnection, subId);
  });

  it('notifySubscribers should notify multiple subscribers with data', async function () {
    const connectionId1 = '12';
    const connectionId2 = '13';
    const wsConnection1 = mockWsConnection(connectionId1);
    const subId1 = subscriptionService.subscribe(wsConnection1, 'logs');
    const spy1 = sandbox.spy(wsConnection1, 'send');
    const wsConnection2 = mockWsConnection(connectionId2);
    const subId2 = subscriptionService.subscribe(wsConnection2, 'logs');
    const spy2 = sandbox.spy(wsConnection2, 'send');
    const testData = 'test example data';

    subscriptionService.notifySubscribers(`{"event":"logs"}`, testData);

    expect(spy1.getCall(0).args[0]).to.be.eq(
      `{"jsonrpc":"2.0","method":"eth_subscription","params":{"result":"${testData}","subscription":"${subId1}"}}`,
    );
    expect(spy2.getCall(0).args[0]).to.be.eq(
      `{"jsonrpc":"2.0","method":"eth_subscription","params":{"result":"${testData}","subscription":"${subId2}"}}`,
    );
    subscriptionService.unsubscribe(wsConnection1, subId1);
    subscriptionService.unsubscribe(wsConnection2, subId2);
  });

  it('notifySubscribers should use cache to not send the data again', async function () {
    const connectionId = '4';
    const wsConnection = mockWsConnection(connectionId);
    const subId = subscriptionService.subscribe(wsConnection, 'logs');
    const spy = sandbox.spy(wsConnection, 'send');
    const testData = 'test example data cached';

    subscriptionService.notifySubscribers(`{"event":"logs"}`, testData);
    subscriptionService.notifySubscribers(`{"event":"logs"}`, testData); // should hit cache
    subscriptionService.notifySubscribers(`{"event":"logs"}`, testData); // should hit cache

    expect(spy.getCall(0).args[0]).to.be.eq(
      `{"jsonrpc":"2.0","method":"eth_subscription","params":{"result":"${testData}","subscription":"${subId}"}}`,
    );
    expect(spy.callCount).to.be.eq(1); // even after making 3 calls, only 1 time spy reports being called on send method
    subscriptionService.unsubscribe(wsConnection, subId);
  });

  it('notifySubscribers using a Tag that has no subscribers should not send anything to connection', async function () {
    const connectionId = '5';
    const wsConnection = mockWsConnection(connectionId);
    const subId = subscriptionService.subscribe(wsConnection, 'logs');
    const spy = sandbox.spy(wsConnection, 'send');
    const testData = 'test example data cached';

    subscriptionService.notifySubscribers(
      `{"event":"logs" filters:{"topics": ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]}}`,
      testData,
    );

    expect(spy.callCount).to.be.eq(0);
    subscriptionService.unsubscribe(wsConnection, subId);
  });

  it('Unsubscribing all subscriptions from same connection', async function () {
    const connectionId = '6';
    const wsConnection = mockWsConnection(connectionId);
    const tag1 = { event: 'logs' };
    const tag2 = {
      event: 'logs',
      filters: { topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] },
    };
    const subId = subscriptionService.subscribe(wsConnection, tag1.event);
    const subId2 = subscriptionService.subscribe(wsConnection, tag2.event, tag2.filters);
    const loggerDebugSpy = sandbox.spy(logger, 'debug');
    const loggerInfoSpy = sandbox.spy(logger, 'info');

    const count = subscriptionService.unsubscribe(wsConnection);

    expect(count).to.be.eq(2);
    expect(loggerInfoSpy.calledWith(`Connection %s: Unsubscribing from all subscriptions`, wsConnection.id)).to.be.eq(
      true,
    );
    expect(
      loggerDebugSpy.calledWith(
        `Connection %s. Unsubscribing subId: %s; tag: %s`,
        wsConnection.id,
        subId,
        JSON.stringify(tag1),
      ),
    ).to.be.eq(true);
    expect(
      loggerDebugSpy.calledWith(
        `Connection %s. Unsubscribing subId: %s; tag: %s`,
        wsConnection.id,
        subId2,
        JSON.stringify(tag2),
      ),
    ).to.be.eq(true);
  });

  it('Unsubscribing single subscriptions from connection', async function () {
    const connectionId = '7';
    const wsConnection = mockWsConnection(connectionId);
    const tag1 = { event: 'logs' };
    const tag2 = {
      event: 'logs',
      filters: { topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] },
    };
    subscriptionService.subscribe(wsConnection, tag1.event);
    const subId2 = subscriptionService.subscribe(wsConnection, tag2.event, tag2.filters);
    const loggerDebugSpy = sandbox.spy(logger, 'debug');
    const loggerInfoSpy = sandbox.spy(logger, 'info');

    const count = subscriptionService.unsubscribe(wsConnection, subId2);

    expect(count).to.be.eq(1);
    expect(loggerInfoSpy.calledWith(`Connection %s: Unsubscribing from %s`, wsConnection.id, subId2)).to.be.eq(true);
    expect(
      loggerDebugSpy.calledWith(
        `Connection %s. Unsubscribing subId: %s; tag: %s`,
        wsConnection.id,
        subId2,
        JSON.stringify(tag2),
      ),
    ).to.be.eq(true);
  });

  it('Unsubscribing without a valid subscription or ws conn should return true', async function () {
    const connectionId = '6';
    const wsConnection = mockWsConnection(connectionId);
    const notRealSubId = '0x123456';

    const count = subscriptionService.unsubscribe(wsConnection, notRealSubId);

    expect(count).to.be.eq(0);
  });

  it('Subscribing to the same event and filters should return the same subscription id', async function () {
    const connectionId = '7';
    const wsConnection = mockWsConnection(connectionId);
    const tag1 = {
      event: 'logs',
      filters: { topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] },
    };
    const subId = subscriptionService.subscribe(wsConnection, tag1.event);
    const subId2 = subscriptionService.subscribe(wsConnection, tag1.event);

    expect(subId).to.be.eq(subId2);
    subscriptionService.unsubscribe(wsConnection, subId);
    subscriptionService.unsubscribe(wsConnection, subId2);
  });

  describe('Subscription limit', async function () {
    const topic = (nonce: number): string => `0x${nonce.toString(16).padStart(64, '0')}`;

    let limitedService: SubscriptionService;
    let pollerAddSpy: sinon.SinonStub;

    overrideEnvsInMochaDescribe({ WS_SUBSCRIPTION_LIMIT: 2 });

    beforeEach(() => {
      limitedService = new SubscriptionService(relay, logger, new Registry());
      const internals = limitedService as unknown as SubscriptionServiceInternals;
      pollerAddSpy = sandbox.stub(internals.pollerService, 'add');
      sandbox.stub(internals.pollerService, 'remove');
    });

    it('increments the connection counter once per newly created subscription', function () {
      const wsConnection = mockWsConnection('limit-new');

      limitedService.subscribe(wsConnection, 'logs', { topics: [topic(1)] });
      expect(wsConnection.subscriptions).to.eq(1);

      limitedService.subscribe(wsConnection, 'logs', { topics: [topic(2)] });
      expect(wsConnection.subscriptions).to.eq(2);
    });

    it('does not increment the counter when an existing subscription id is returned', function () {
      const wsConnection = mockWsConnection('limit-repeat');
      const filters = { topics: [topic(1)] };

      const subId = limitedService.subscribe(wsConnection, 'logs', filters);
      const repeated = [
        limitedService.subscribe(wsConnection, 'logs', filters),
        limitedService.subscribe(wsConnection, 'logs', filters),
        limitedService.subscribe(wsConnection, 'logs', filters),
      ];

      expect(repeated).to.deep.eq([subId, subId, subId]);
      expect(wsConnection.subscriptions).to.eq(1);
    });

    it('throws MAX_SUBSCRIPTIONS once the connection is at the limit', function () {
      const wsConnection = mockWsConnection('limit-exceeded');

      limitedService.subscribe(wsConnection, 'logs', { topics: [topic(1)] });
      limitedService.subscribe(wsConnection, 'logs', { topics: [topic(2)] });

      expect(() => limitedService.subscribe(wsConnection, 'logs', { topics: [topic(3)] }))
        .to.throw(JsonRpcError)
        .with.property('code', predefined.MAX_SUBSCRIPTIONS.code);
      expect(wsConnection.subscriptions).to.eq(2);
    });

    it('registers neither a poll nor a tag for a refused subscription', function () {
      const wsConnection = mockWsConnection('limit-refused');
      const refusedFilters = { topics: [topic(3)] };

      limitedService.subscribe(wsConnection, 'logs', { topics: [topic(1)] });
      limitedService.subscribe(wsConnection, 'logs', { topics: [topic(2)] });
      expect(() => limitedService.subscribe(wsConnection, 'logs', refusedFilters)).to.throw(JsonRpcError);

      const refusedTag = JSON.stringify({ event: 'logs', filters: refusedFilters });
      expect(pollerAddSpy.callCount).to.eq(2);
      expect(pollerAddSpy.calledWith(refusedTag)).to.be.false;
      expect(limitedService['subscriptions']).to.not.have.property(refusedTag);
    });

    it('frees a slot on unsubscribe so a later subscription is admitted', function () {
      const wsConnection = mockWsConnection('limit-freed');

      const subId = limitedService.subscribe(wsConnection, 'logs', { topics: [topic(1)] });
      limitedService.subscribe(wsConnection, 'logs', { topics: [topic(2)] });

      const unsubbed = limitedService.unsubscribe(wsConnection, subId);
      limiter.decrementSubs(wsConnection, unsubbed);

      expect(() => limitedService.subscribe(wsConnection, 'logs', { topics: [topic(3)] })).to.not.throw();
      expect(wsConnection.subscriptions).to.eq(2);
    });
  });

  describe('With WS_SAME_SUB_FOR_SAME_EVENT == `false`', async function () {
    let subscriptionService: SubscriptionService;

    overrideEnvsInMochaDescribe({ WS_SAME_SUB_FOR_SAME_EVENT: false });

    before(() => {
      const registry = new Registry();
      subscriptionService = new SubscriptionService(relay, logger, registry);
    });

    it('Subscribing to the same event and filters should return different subscription id', async function () {
      const connectionId = '7';
      const wsConnection = mockWsConnection(connectionId);
      const tag1 = {
        event: 'logs',
        filters: { topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] },
      };
      const subId = subscriptionService.subscribe(wsConnection, tag1.event);
      const subId2 = subscriptionService.subscribe(wsConnection, tag1.event);

      expect(subId).to.be.not.eq(subId2);
      subscriptionService.unsubscribe(wsConnection, subId);
      subscriptionService.unsubscribe(wsConnection, subId2);
    });
  });
});
