// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Relay } from '@hashgraph/json-rpc-relay';
import { expect } from 'chai';
import http from 'http';
import { AddressInfo } from 'net';
import sinon from 'sinon';
import WebSocket from 'ws';

import * as jsonRpcController from '../../dist/controllers/jsonRpcController';
import wsMetricRegistry from '../../dist/metrics/wsMetricRegistry';
import * as utils from '../../dist/utils/utils';
import * as webSocketServer from '../../dist/webSocketServer';

async function httpGet(server: http.Server, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!isAddressInfo(addr)) {
      reject(new Error('Invalid server address'));
      return;
    }
    http
      .get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, text: data }));
      })
      .on('error', reject);
  });
}

const isAddressInfo = (addr: string | AddressInfo | null): addr is AddressInfo => {
  return !!addr && typeof addr !== 'string';
};

function wsUrl(server: http.Server): string {
  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error('Invalid server address');
  }
  return `ws://127.0.0.1:${address.port}`;
}

describe('webSocketServer http endpoints', () => {
  let server: http.Server<any, any>;
  let httpApp: any;
  let mockRelay: any;

  beforeEach(async function () {
    // Create a mock relay object
    mockRelay = {
      eth: sinon.stub().returns({ chainId: () => '0x12a' }),
      mirrorClient: sinon.stub(),
    };
    sinon.stub(Relay, 'init').resolves(mockRelay as any);

    const wsServer = await webSocketServer.initializeWsServer();
    httpApp = wsServer.httpApp;

    // Create HTTP server from the Koa app
    server = http.createServer(httpApp.callback());
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterEach((done) => {
    sinon.restore();
    server.close(done);
  });

  it('should return 200 for /metrics', async () => {
    const res = await httpGet(server, '/metrics');

    expect(res.status).to.equal(200);
    expect(res.text).to.contain('rpc_relay_');
  });

  it('should return 200 for /health/liveness', async () => {
    const res = await httpGet(server, '/health/liveness');

    expect(res.status).to.equal(200);
  });

  it('should return 200 for /health/readiness when chainId is valid', async () => {
    const res = await httpGet(server, '/health/readiness');

    expect(mockRelay.eth.called).to.be.true;
    expect(res.status).to.equal(200);
    expect(res.text).to.equal('OK');
  });

  it('should return 503 and DOWN for /health/readiness when chainId is not valid', async () => {
    mockRelay.eth.returns({ chainId: () => '0x' });
    const res = await httpGet(server, '/health/readiness');

    expect(mockRelay.eth.called).to.be.true;
    expect(res.status).to.equal(503);
    expect(res.text).to.equal('DOWN');
  });

  it('should log and throw when /health/readiness handler errors', async () => {
    // Override the mock to throw an error
    mockRelay.eth.throws(new Error('Test error'));
    const res = await httpGet(server, '/health/readiness');

    expect(res.status).to.equal(500);
  });

  it('should throw 404 for unknown path', async () => {
    const res = await httpGet(server, '/unknown-path');

    expect(res.status).to.equal(404);
  });
});

describe('webSocketServer websocket handling', () => {
  let server: http.Server<any, any>;
  const sockets: WebSocket[] = [];

  async function openWsServerAndUpdateSockets(server, socketsArr) {
    const ws = new WebSocket(wsUrl(server));
    socketsArr.push(ws);
    await new Promise((resolve) => ws.on('open', resolve));

    return ws;
  }

  beforeEach(async function () {
    // Initialize the WebSocket server with mocked dependencies
    const mockRelay = {
      eth: sinon.stub().returns({ chainId: () => '0x12a' }),
      mirrorClient: sinon.stub(),
    };
    sinon.stub(Relay, 'init').resolves(mockRelay as any);
    const { app } = await webSocketServer.initializeWsServer();

    // Start the WebSocket server and wait for it to start
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterEach((done) => {
    sinon.restore();
    for (const s of sockets) {
      try {
        s.terminate();
      } catch {
        // handle error
      }
    }
    sockets.length = 0;
    server.close(done);
  });

  it('should send INVALID_REQUEST on malformed JSON', async () => {
    const ws = await openWsServerAndUpdateSockets(server, sockets);
    ws.send('not-json');

    const msg = await new Promise<string>((resolve) => ws.on('message', (data) => resolve(data.toString())));
    expect(JSON.parse(msg).error?.code).to.equal(-32600);
    await ws.close();
  });

  it('should return WS_BATCH_REQUESTS_DISABLED when batch requests are disabled', async () => {
    const getWsBatchRequestsEnabledStub = sinon.stub(utils, 'getWsBatchRequestsEnabled').returns(false);
    const ws = await openWsServerAndUpdateSockets(server, sockets);
    ws.send(JSON.stringify([{ id: 1, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] }]));

    const msg = await new Promise<string>((resolve) => ws.on('message', (data) => resolve(data.toString())));
    expect(getWsBatchRequestsEnabledStub.calledOnce).to.be.true;

    const parsed = JSON.parse(msg);
    expect(Array.isArray(parsed)).to.be.true;
    expect(parsed[0].error?.code).to.equal(-32205);
    await ws.close();
  });

  it('should return BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED when batch is too large', async () => {
    sinon.stub(utils, 'getWsBatchRequestsEnabled').returns(true);
    sinon.stub(utils, 'getBatchRequestsMaxSize').returns(1);
    const ws = await openWsServerAndUpdateSockets(server, sockets);
    ws.send(
      JSON.stringify([
        { id: 1, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] },
        { id: 2, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] },
      ]),
    );

    const msg = await new Promise<string>((resolve) => ws.on('message', (data) => resolve(data.toString())));
    const parsed = JSON.parse(msg);
    expect(Array.isArray(parsed)).to.be.true;
    expect(parsed[0].error?.code).to.be.a('number');
    await ws.close();
  });

  it('shuold be able to process a single request', async () => {
    const sendToClientStub = sinon.stub(utils, 'sendToClient');
    sinon.stub(jsonRpcController, 'getRequestResult').resolves({ id: 1, jsonrpc: '2.0', result: 'ok' });

    const ws = await openWsServerAndUpdateSockets(server, sockets);
    ws.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'web3_clientVersion', params: [] }));

    await new Promise((r) => setTimeout(r, 50));
    await ws.close();

    expect(sendToClientStub.calledOnce).to.be.true;
  });

  it('should generate a correct label for messageDuration histogram', async () => {
    const histStub = sinon.stub(wsMetricRegistry.prototype, 'getHistogram').returns({
      labels: () => ({ observe: sinon.stub() }),
    } as any);
    sinon.stub(jsonRpcController, 'getRequestResult').resolves({ id: 1, jsonrpc: '2.0', result: 'ok' });
    const ws = await openWsServerAndUpdateSockets(server, sockets);
    ws.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'web3_clientVersion', params: [] }));

    await new Promise((r) => setTimeout(r, 50));
    await ws.close();

    expect(histStub.calledWith('messageDuration')).to.be.true;
  });

  it('should be able to execute batch request', async () => {
    sinon.stub(ConfigService, 'get').callsFake(((key: string) => {
      if (key === 'BATCH_REQUESTS_DISALLOWED_METHODS') return [];
      return process.env[key] as any;
    }) as any);
    sinon.stub(utils, 'getWsBatchRequestsEnabled').returns(true);
    sinon.stub(utils, 'getBatchRequestsMaxSize').returns(2);
    const ws = await openWsServerAndUpdateSockets(server, sockets);

    const grrStub = sinon.stub(jsonRpcController, 'getRequestResult');
    grrStub.onCall(0).resolves({ id: 1, jsonrpc: '2.0', result: 'a' });
    grrStub.onCall(1).resolves({ id: 2, jsonrpc: '2.0', result: 'b' });
    const sendToClientStub = sinon.stub(utils, 'sendToClient');
    const sendToClientCalled = new Promise<void>((resolve) => {
      sendToClientStub.callsFake(() => {
        resolve();
      });
    });
    ws.send(
      JSON.stringify([
        { id: 1, jsonrpc: '2.0', method: 'web3_clientVersion', params: [] },
        { id: 2, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] },
      ]),
    );

    await sendToClientCalled;
    await ws.close();

    expect(grrStub.callCount).to.equal(2);
    expect(sendToClientStub.calledOnce).to.be.true;

    const { args } = sendToClientStub.getCall(0);
    expect(Array.isArray(args[2])).to.be.true;
  });
});
