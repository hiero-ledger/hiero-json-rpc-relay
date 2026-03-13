// SPDX-License-Identifier: Apache-2.0

// external resources
import { expect } from 'chai';

import { Utils } from '../../server/helpers/utils';
import { WsTestHelper } from '../helper';

describe('@web-socket-batch-2 web3_clientVersion', async function () {
  const METHOD_NAME = 'web3_clientVersion';

  let requestId: string;

  // @ts-ignore
  const { relay } = global;

  before(async () => {
    requestId = Utils.generateRequestId();
  });

  it(`@release Should execute web3_clientVersion on Standard Web Socket and handle valid requests correctly`, async () => {
    const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, []);
    expect(response.result).to.exist;
    expect(response.result).to.be.a('string');
    const clientVersion = await relay.call('web3_clientVersion', [], requestId);
    expect(response.result).to.equal(clientVersion);
  });
});
