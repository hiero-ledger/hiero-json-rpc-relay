// SPDX-License-Identifier: Apache-2.0
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { expect } from 'chai';
import sinon from 'sinon';

import { ConfigService } from '../../../config-service/dist/services';
import * as webSocketServer from '../../dist/webSocketServer';

describe('WebSocket Server Main', () => {
  let initializeWsServerStub: sinon.SinonStub;
  let mockApp: any;
  let mockHttpApp: any;
  let loggerFatalStub: sinon.SinonStub;
  let configGetStub: sinon.SinonStub;
  let processExitStub: sinon.SinonStub;

  beforeEach(() => {
    // Create mock objects with listen methods
    mockApp = { listen: sinon.stub() };
    mockHttpApp = { listen: sinon.stub() };

    // Stub the functions we need
    configGetStub = sinon.stub(ConfigService, 'get').returns('127.0.0.1');
    processExitStub = sinon.stub(process, 'exit');

    // Stub the logger.fatal method from webSocketServer
    loggerFatalStub = sinon.stub(webSocketServer.logger, 'fatal');

    // Stub initializeWsServer to return our mocks
    initializeWsServerStub = sinon.stub(webSocketServer, 'initializeWsServer').resolves({
      app: mockApp,
      httpApp: mockHttpApp,
    });
  });

  afterEach(() => {
    sinon.restore();
    // Clear the module cache to allow fresh imports
    delete require.cache[require.resolve('../../dist/index.js')];
  });

  it('should initialize and start both WebSocket and HTTP servers successfully', async () => {
    // Import and execute the main module
    await import('../../dist/index.js');

    await new Promise((resolve) => setInterval(resolve, 100));

    expect(initializeWsServerStub.calledOnce).to.equal(true);
    expect(configGetStub.calledWith('SERVER_HOST')).to.equal(true);

    expect(mockApp.listen.calledOnce).to.equal(true);
    expect(mockApp.listen.calledWith({ port: constants.WEB_SOCKET_PORT, host: '127.0.0.1' })).to.equal(true);

    expect(mockHttpApp.listen.calledOnce).to.equal(true);
    expect(mockHttpApp.listen.calledWith({ port: constants.WEB_SOCKET_HTTP_PORT, host: '127.0.0.1' })).to.equal(true);

    expect(loggerFatalStub.calledOnce).to.equal(false);
    expect(processExitStub.called).to.equal(false);
  });

  it('should handle initialization errors and exit gracefully', async () => {
    // Make initializeWsServer throw an error
    const testError = new Error('Initialization failed');
    initializeWsServerStub.rejects(testError);

    await import('../../dist/index.js');

    await new Promise((resolve) => setInterval(resolve, 100));

    expect(loggerFatalStub.calledOnce).to.equal(true);
    expect(loggerFatalStub.calledWith(testError)).to.equal(true);

    expect(processExitStub.calledOnce).to.equal(true);
    expect(processExitStub.calledWith(1)).to.equal(true);

    expect(mockApp.listen.called).to.equal(false);
    expect(mockHttpApp.listen.called).to.equal(false);
  });
});
