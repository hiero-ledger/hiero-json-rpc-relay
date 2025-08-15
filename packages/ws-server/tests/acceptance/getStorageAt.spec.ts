// SPDX-License-Identifier: Apache-2.0

// external resources
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-2 eth_getStorageAt', async function () {
  const METHOD_NAME = 'eth_getStorageAt';
  const EXPECTED_VALUE = 7;
  const INVALID_PARAMS = [
    [],
    ['', ''],
    ['', '0x0'],
    [WsTestConstant.FAKE_TX_HASH],
    [WsTestConstant.FAKE_TX_HASH, ''],
    [WsTestConstant.FAKE_TX_HASH, 36, 'latest'],
    [WsTestConstant.FAKE_TX_HASH, '0xhbar', 'latest'],
  ];

  // @notice: The simple contract artifacts (ABI & bytecode) below simply has one state at position 0, which will be assigned to the number `7` within the consutrctor after deployment
  const SIMPLE_CONTRACT_ABI = [
    {
      inputs: [],
      stateMutability: 'nonpayable',
      type: 'constructor',
    },
  ];
  const SIMPLE_CONTRACT_BYTECODE =
    '0x6080604052348015600f57600080fd5b506007600081905550603f8060256000396000f3fe6080604052600080fdfea2646970667358221220416347bd1607cf1f0e7ec93afab3d5fe283173dd5e6ce3928dce940edd5c1fb564736f6c63430008180033';
  // @ts-ignore
  const { mirrorNode } = global;
  let params: any[], ethersWsProvider: WebSocketProvider;

  const accounts: AliasAccount[] = [];

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '2500000000'; //25 Hbar

    const neededAccounts: number = 1;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialAmount)),
    );
    global.accounts.push(...accounts);

    const contractFactory = new ethers.ContractFactory(
      SIMPLE_CONTRACT_ABI,
      SIMPLE_CONTRACT_BYTECODE,
      accounts[0].wallet,
    );
    const contract = await contractFactory.deploy();
    await contract.waitForDeployment();

    // prepare transaction params - [contract address, position, blockTag]
    params = [contract.target, '0x0', 'latest'];
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
      it(`Should fail eth_getStorageAt on Standard Web Socket and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getStorageAt on Standard Web Socket and handle valid requests correctly`, async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, params);
      WsTestHelper.assertJsonRpcObject(response);
      expect(parseInt(response.result)).to.eq(EXPECTED_VALUE);
    });
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_getStorageAt on Ethers Web Socket Provider and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsEthersWsProvider(ethersWsProvider, METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getStorageAt on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
      const result = await ethersWsProvider.send(METHOD_NAME, params);
      expect(parseInt(result)).to.eq(EXPECTED_VALUE);
    });
  });
});
