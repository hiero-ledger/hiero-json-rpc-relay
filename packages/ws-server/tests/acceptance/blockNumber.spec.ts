// SPDX-License-Identifier: Apache-2.0

// external resources
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@release @web-socket-batch-1 eth_blockNumber', async function () {
  const METHOD_NAME = 'eth_blockNumber';

  let ethersWsProvider: WebSocketProvider;

  beforeEach(async () => {
    ethersWsProvider = new ethers.WebSocketProvider(WsTestConstant.WS_RELAY_URL);
  });

  afterEach(async () => {
    if (ethersWsProvider) await ethersWsProvider.destroy();
  });

  after(async () => {
    // expect all the connections to the WS server to be closed after all
    if (global && global.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  describe(WsTestConstant.STANDARD_WEB_SOCKET, () => {
    it(`Should execute eth_blockNumber on Standard Web Socket and handle valid requests correctly`, async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, []);
      WsTestHelper.assertJsonRpcObject(response);
      expect(Number(response.result)).to.gte(0);
      expect(response.result.startsWith('0x')).to.be.true;
    });
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    it(`Should execute eth_blockNumber on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
      const response = await ethersWsProvider.send(METHOD_NAME, []);
      expect(Number(response)).to.gte(0);
      expect(response.startsWith('0x')).to.be.true;
    });
  });
});
