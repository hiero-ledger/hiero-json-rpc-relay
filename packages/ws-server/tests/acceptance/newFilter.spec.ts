// SPDX-License-Identifier: Apache-2.0

import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-2 eth_newFilter', async function () {
  let wsFilterObj: any, ethersWsProvider: WebSocketProvider;
  const METHOD_NAME = 'eth_newFilter';
  const INVALID_PARAMS = [
    [],
    [
      {
        address: WsTestConstant.FAKE_TX_HASH,
        fromBlock: '0xhedera',
        toBlock: 'latest',
      },
    ],
    [
      {
        address: WsTestConstant.FAKE_TX_HASH,
        fromBlock: 'latest',
        toBlock: '0xhedera',
      },
    ],
  ];

  const SIMPLE_CONTRACT_BYTECODE =
    '0x6080604052348015600f57600080fd5b507f4e7df42af9a017b7c655a28ef10cbc8f05b2b088f087ee02416cfa1a96ac3be26007604051603e91906091565b60405180910390a160aa565b6000819050919050565b6000819050919050565b6000819050919050565b6000607d6079607584604a565b605e565b6054565b9050919050565b608b816068565b82525050565b600060208201905060a460008301846084565b92915050565b603f8060b76000396000f3fe6080604052600080fdfea264697066735822122084db7fe76bde5c9c041d61bb40294c56dc6d339bdbc8e0cd285fc4008ccefc2c64736f6c63430008180033';

  before(async () => {
    // deploy contract
    const contract = await Utils.deployContract([], SIMPLE_CONTRACT_BYTECODE, global.accounts[0].wallet);

    wsFilterObj = {
      address: [contract.target],
      fromBlock: '0x0',
      toBlock: 'latest',
    };
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
      it(`Should fail eth_newFilter on Standard Web Socket and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${JSON.stringify(
        params,
      )}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_newFilter on Standard Web Socket and handle valid requests correctly`, async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [wsFilterObj]);
      WsTestHelper.assertJsonRpcObject(response);
      const filterId = response.result;

      expect(filterId).to.exist;
      expect(filterId.startsWith('0x')).to.be.true;
      expect(filterId.slice(2).length).to.eq(32); // 16 bytes
    });
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_newFilter on Ethers Web Socket Provider and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${JSON.stringify(
        params,
      )}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsEthersWsProvider(ethersWsProvider, METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_newFilter on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
      const filterId = await ethersWsProvider.send(METHOD_NAME, [wsFilterObj]);

      expect(filterId).to.exist;
      expect(filterId.startsWith('0x')).to.be.true;
      expect(filterId.slice(2).length).to.eq(32); // 16 bytes
    });
  });
});
