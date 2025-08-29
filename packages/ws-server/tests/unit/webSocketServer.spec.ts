// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import http from 'http';
import sinon from 'sinon';
import WebSocket from 'ws';

import * as jsonRpcController from '../../dist/controllers/jsonRpcController';
import wsMetricRegistry from '../../dist/metrics/wsMetricRegistry';
import * as utils from '../../dist/utils/utils';
import { app, httpApp, logger, relay } from '../../dist/webSocketServer';

async function httpGet(server: http.Server, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${server.address().port}${path}`, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, text: data }));
      })
      .on('error', reject);
  });
}

function wsUrl(server): string {
  return `ws://127.0.0.1:${server.address().port}`;
}

function createMirrorStubServer(): http.Server<any, any> {
  return http.createServer((req: any, res: any) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    const url = req.url || '';
    if (url.startsWith('/api/v1/blocks') || url.startsWith('/blocks')) {
      res.end(JSON.stringify({ blocks: [{ number: 5644, timestamp: { to: '0.0.5644' } }] }));
    } else if (url.startsWith('/api/v1/accounts') || url.startsWith('/accounts')) {
      res.end(JSON.stringify({ balance: { balance: 1 }, account: '0.0.2', transactions: [], links: {} }));
    } else {
      res.end(JSON.stringify({}));
    }
  });
}

describe('webSocketServer http endpoints', () => {
  let server: http.Server<any, any>;
  let mirrorStubServer: http.Server<any, any>;

  beforeEach((done) => {
    mirrorStubServer = createMirrorStubServer();
    mirrorStubServer.listen(5551, '127.0.0.1', () => {
      server = http.createServer(httpApp.callback());
      server.listen(0, '127.0.0.1', done);
    });
  });

  afterEach((done) => {
    sinon.restore();
    server.close(() => {
      mirrorStubServer.close(() => done());
    });
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
    const ethStub = sinon.stub(relay, 'eth').returns({ chainId: () => '0x12a' } as any);
    const res = await httpGet(server, '/health/readiness');

    expect(ethStub.calledOnce).to.be.true;
    expect(res.status).to.equal(200);
    expect(res.text).to.equal('OK');
  });

  it('should return 503 and DOWN for /health/readiness when chainId is not valid', async () => {
    const ethStub = sinon.stub(relay, 'eth').returns({ chainId: () => '0xabc' } as any);
    const res = await httpGet(server, '/health/readiness');

    expect(ethStub.calledOnce).to.be.true;
    expect(res.status).to.equal(503);
    expect(res.text).to.equal('DOWN');
  });

  it('should log and throw when /health/readiness handler errors', async () => {
    sinon.stub(relay, 'eth').throws(new Error());
    const logStub = sinon.stub(logger, 'error');
    const res = await httpGet(server, '/health/readiness');

    expect(res.status).to.equal(500);
    expect(logStub.called).to.be.true;
  });

  it('should throw 404 for unknown path', async () => {
    const res = await httpGet(server, '/unknown-path');

    expect(res.status).to.equal(404);
  });
});

describe('webSocketServer websocket handling', () => {
  let server: http.Server<any, any>;
  let mirrorStubServer: http.Server<any, any>;
  const sockets: WebSocket[] = [];

  async function openWsServerAndUpdateSockets(server, socketsArr) {
    const ws = new WebSocket(wsUrl(server));
    socketsArr.push(ws);
    await new Promise((resolve) => ws.on('open', resolve));

    return ws;
  }

  beforeEach((done) => {
    mirrorStubServer = createMirrorStubServer();
    mirrorStubServer.listen(5551, '127.0.0.1', () => {
      server = app.listen(0, '127.0.0.1', done);
    });
  });

  afterEach((done) => {
    sinon.restore();
    for (const s of sockets) {
      try {
        s.terminate();
      } catch (e) {
        // handle error
      }
    }
    sockets.length = 0;
    server.close(() => {
      mirrorStubServer.close(() => done());
    });
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
    ws.send(
      JSON.stringify([
        { id: 1, jsonrpc: '2.0', method: 'web3_clientVersion', params: [] },
        { id: 2, jsonrpc: '2.0', method: 'eth_blockNumber', params: [] },
      ]),
    );

    await new Promise((r) => setTimeout(r, 50));
    await ws.close();

    expect(grrStub.callCount).to.equal(2);
    expect(sendToClientStub.calledOnce).to.be.true;

    const { args } = sendToClientStub.getCall(0);
    expect(Array.isArray(args[2])).to.be.true;
  });
});
