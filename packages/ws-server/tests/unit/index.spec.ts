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
  let mockLogger: any;
  let configGetStub: sinon.SinonStub;
  let consoleErrorStub: sinon.SinonStub;
  let processExitStub: sinon.SinonStub;

  beforeEach(() => {
    // Create mock objects with listen methods
    mockApp = { listen: sinon.stub() };
    mockHttpApp = { listen: sinon.stub() };
    mockLogger = {
      info: sinon.stub(),
      error: sinon.stub(),
      fatal: sinon.stub(),
    };

    // Stub the functions we need
    configGetStub = sinon.stub(ConfigService, 'get').returns('127.0.0.1');
    consoleErrorStub = sinon.stub(console, 'error');
    processExitStub = sinon.stub(process, 'exit');

    // Stub initializeWsServer to return our mocks
    initializeWsServerStub = sinon.stub(webSocketServer, 'initializeWsServer').resolves({
      app: mockApp,
      httpApp: mockHttpApp,
      logger: mockLogger,
      relay: {} as any, // Mock relay object
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

    expect(initializeWsServerStub.calledOnce).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
    expect(configGetStub.calledWith('SERVER_HOST')).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

    expect(mockApp.listen.calledOnce).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
    expect(mockApp.listen.calledWith({ port: constants.WEB_SOCKET_PORT, host: '127.0.0.1' })).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

    expect(mockHttpApp.listen.calledOnce).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
    expect(mockHttpApp.listen.calledWith({ port: constants.WEB_SOCKET_HTTP_PORT, host: '127.0.0.1' })).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

    // Verify no errors were logged
    expect(consoleErrorStub.called).to.be.false; // eslint-disable-line @typescript-eslint/no-unused-expressions
    expect(processExitStub.called).to.be.false; // eslint-disable-line @typescript-eslint/no-unused-expressions
  });

  it('should handle initialization errors and exit gracefully', async () => {
    // Make initializeWsServer throw an error
    const testError = new Error('Initialization failed');
    initializeWsServerStub.rejects(testError);

    await import('../../dist/index.js');

    await new Promise((resolve) => setInterval(resolve, 100));

    expect(consoleErrorStub.calledOnce).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
    expect(consoleErrorStub.calledWith('Failed to initialize WebSocket server:', testError)).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

    expect(processExitStub.calledOnce).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
    expect(processExitStub.calledWith(1)).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

    expect(mockApp.listen.called).to.be.false; // eslint-disable-line @typescript-eslint/no-unused-expressions
    expect(mockHttpApp.listen.called).to.be.false; // eslint-disable-line @typescript-eslint/no-unused-expressions
  });
});
