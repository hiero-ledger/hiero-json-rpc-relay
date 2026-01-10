// SPDX-License-Identifier: Apache-2.0

// external resources
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-1 eth_getBlockByNumber', async function () {
  const METHOD_NAME = 'eth_getBlockByNumber';
  const INVALID_PARAMS = [
    [],
    ['0x36'],
    ['0x36', '0xhbar'],
    ['0x36', '54'],
    ['0x36', 'true', 39],
    ['0xhedera', true],
    ['0xhbar', false],
    ['0xnetwork', false],
  ];

  let ethersWsProvider: WebSocketProvider;

  beforeEach(async () => {
    ethersWsProvider = new ethers.WebSocketProvider(WsTestConstant.WS_RELAY_URL);
  });

  afterEach(async () => {
    if (ethersWsProvider) await ethersWsProvider.destroy();
  });

  after(async () => {
    // expect all the connections to be closed after all
    if (global && global.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  describe(WsTestConstant.STANDARD_WEB_SOCKET, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_getBlockByNumber on Standard Web Socket and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getBlockByNumber on Standard Web Socket and handle valid requests correctly`, async () => {
      const expectedResult = await global.relay.call(METHOD_NAME, ['latest', false]);
      const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [expectedResult.number, true]);
      await Utils.wait(1000);
      WsTestHelper.assertJsonRpcObject(response);
      expect(response.result).to.deep.eq(expectedResult);
    });
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_getBlockByNumber on Ethers Web Socket Provider and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsEthersWsProvider(ethersWsProvider, METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getBlockByNumber on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
      const expectedResult = await global.relay.call(METHOD_NAME, ['latest', false]);
      const result = await ethersWsProvider.send(METHOD_NAME, [expectedResult.number, true]);
      await Utils.wait(1000);
      expect(result).to.deep.eq(expectedResult);
    });
  });
});
