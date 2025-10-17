// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import sinon from 'sinon';

import { ConfigService } from '../../../config-service/dist/services';
import * as webSocketServer from '../../dist/webSocketServer';

describe('main', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should start server if ensureOperatorHasBalance succeeds', async () => {
    const appListenStub = sinon.stub(webSocketServer.app, 'listen');
    const configGetStub = sinon.stub(ConfigService, 'get').returns('127.0.0.1');
    const initStub = sinon.stub(webSocketServer.relay, 'init').resolves();
    const httpAppListenStub = sinon.stub(webSocketServer.httpApp, 'listen');
    const loggerFatalStub = sinon.stub(webSocketServer.logger, 'fatal');

    await import('../../dist/index.js');

    expect(appListenStub.calledOnce).to.be.true;
    expect(configGetStub.calledWith('SERVER_HOST')).to.be.true;
    expect(initStub.calledOnce).to.be.true;
    expect(httpAppListenStub.calledOnce).to.be.true;
    expect(loggerFatalStub.notCalled).to.be.true;
  });
});
