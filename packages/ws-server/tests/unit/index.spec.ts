// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import sinon from 'sinon';

import Assertions from '../../../server/tests/helpers/assertions';
import { deps, main } from '../../dist';

describe('main', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should start server if ensureOperatorHasBalance succeeds', async () => {
    const appListenStub = sinon.stub(deps.app, 'listen');
    const configGetStub = sinon.stub(deps.ConfigService, 'get').returns('127.0.0.1');
    const ensureBalanceStub = sinon.stub(deps.relay, 'ensureOperatorHasBalance').resolves();
    const httpAppListenStub = sinon.stub(deps.httpApp, 'listen');
    const loggerFatalStub = sinon.stub(deps.logger, 'fatal');
    const processExitStub = sinon.stub(process, 'exit' as any);

    await main();

    expect(appListenStub.calledOnce).to.be.true;
    expect(configGetStub.calledWith('SERVER_HOST')).to.be.true;
    expect(ensureBalanceStub.calledOnce).to.be.true;
    expect(httpAppListenStub.calledOnce).to.be.true;
    expect(loggerFatalStub.notCalled).to.be.true;
    expect(processExitStub.notCalled).to.be.true;
  });

  it('should not start server if ensureOperatorHasBalance throws an error', async function () {
    const processExitError = 'process-exit-error';
    try {
      sinon.stub(deps.relay, 'ensureOperatorHasBalance').throws(new Error());
      sinon.stub(deps.logger, 'fatal').returns(true);
      sinon.stub(deps.process, 'exit').throws(new Error(processExitError));

      await main();

      Assertions.expectedError();
    } catch (e: any) {
      expect(e.message).to.contain(processExitError);
    }
  });
});
