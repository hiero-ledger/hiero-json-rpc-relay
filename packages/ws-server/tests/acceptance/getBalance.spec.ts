// SPDX-License-Identifier: Apache-2.0

// external resources
import MirrorClient from '@hashgraph/json-rpc-server/tests/clients/mirrorClient';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-1 eth_getBalance', async function () {
  const METHOD_NAME = 'eth_getBalance';
  const INVALID_PARAMS = [
    [],
    [false],
    [WsTestConstant.FAKE_TX_HASH],
    ['0xhbar', 'latest'],
    ['0xhedera', 'latest'],
    [WsTestConstant.FAKE_TX_HASH, true, 39],
    [WsTestConstant.FAKE_TX_HASH, '0xhedera'],
    [WsTestConstant.FAKE_TX_HASH, '0xhbar', 36],
  ];
  // @ts-ignore
  const { mirrorNode }: { mirrorNode: MirrorClient } = global;

  const accounts: AliasAccount[] = [];
  let ethersWsProvider: WebSocketProvider;

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '2500000000'; //25 Hbar

    const neededAccounts: number = 1;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialAmount)),
    );
    global.accounts.push(...accounts);
  });

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
      it(`Should fail eth_getBalance on Standard Web Socket and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getBalance on Standard Web Socket and handle valid requests correctly`, async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [accounts[0].address, 'latest']);
      WsTestHelper.assertJsonRpcObject(response);

      const expectedResult = await global.relay.call(METHOD_NAME, [accounts[0].address, 'latest']);
      expect(response.result).to.eq(expectedResult);
    });
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_getBalance on Ethers Web Socket Provider and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsEthersWsProvider(ethersWsProvider, METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getBalance on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
      const expectedResult = await global.relay.call(METHOD_NAME, [accounts[0].address, 'latest']);
      const result = await ethersWsProvider.send(METHOD_NAME, [accounts[0].address, 'latest']);
      expect(result).to.eq(expectedResult);
    });
  });
});
