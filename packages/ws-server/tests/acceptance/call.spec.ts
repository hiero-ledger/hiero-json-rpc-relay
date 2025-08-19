// SPDX-License-Identifier: Apache-2.0

// external resources
import ERC20MockJson from '@hashgraph/json-rpc-server/tests/contracts/ERC20Mock.json';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-1 eth_call', async function () {
  const METHOD_NAME = 'eth_call';
  const INVALID_PARAMS = [
    ['{}', false, '0x0'],
    ["{ to: '0xabcdef', data: '0x1a2b3c4d' }", 36, ''],
  ];

  const INVALID_TX_INFO = [
    [{ to: 123, data: '0x18160ddd' }, 'latest'],
    [{ to: '0x', data: '0x18160ddd' }, 'latest'],
    [{ to: '0xabcdef', data: '0x18160ddd' }, 'latest'],
  ];

  const TOKEN_NAME = Utils.randomString(10);
  const TOKEN_SYMBOL = Utils.randomString(5);
  const TOKEN_INIT_SUPPLY = 10000n;

  const VALID_DATA = [
    {
      sighash: '0x06fdde03',
      output: TOKEN_NAME,
    },
    {
      sighash: '0x95d89b41',
      output: TOKEN_SYMBOL,
    },
    {
      sighash: '0x18160ddd',
      output: TOKEN_INIT_SUPPLY,
    },
  ];
  // @ts-ignore
  const { mirrorNode } = global;

  const accounts: AliasAccount[] = [];
  let erc20TokenAddr: string, ethersWsProvider: WebSocketProvider, erc20EtherInterface: ethers.Interface;

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '2500000000'; //25 Hbar

    const neededAccounts: number = 1;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialAmount)),
    );
    global.accounts.push(...accounts);

    const erc20Contract = await Utils.deployContractWithEthers(
      [TOKEN_NAME, TOKEN_SYMBOL, accounts[0].address, TOKEN_INIT_SUPPLY],
      ERC20MockJson,
      accounts[0].wallet,
      global.relay,
    );

    erc20TokenAddr = await erc20Contract.getAddress();
    erc20EtherInterface = new ethers.Interface(ERC20MockJson.abi);
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
      it(`Should fail eth_call on Standard Web Socket and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    for (const params of INVALID_TX_INFO) {
      it(`Should fail eth_call on ${
        WsTestConstant.STANDARD_WEB_SOCKET
      } and handle invalid TX_INFO. params=[${JSON.stringify(params)}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    for (const data of VALID_DATA) {
      it(`@release Should execute eth_call on Standard Web Socket and handle valid requests correctly`, async () => {
        const tx = {
          to: erc20TokenAddr,
          data: data.sighash,
        };

        const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [tx, 'latest']);
        WsTestHelper.assertJsonRpcObject(response);

        const outputASCII = erc20EtherInterface.decodeFunctionResult(
          erc20EtherInterface.getFunction(data.sighash)!,
          response.result,
        );
        expect(outputASCII[0]).to.eq(data.output);
      });
    }
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_call on Ethers Web Socket Provider and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsEthersWsProvider(ethersWsProvider, METHOD_NAME, params);
      });
    }

    for (const params of INVALID_TX_INFO) {
      it(`Should fail eth_call on ${
        WsTestConstant.ETHERS_WS_PROVIDER
      } and handle invalid TX_INFO. params=[${JSON.stringify(params)}]`, async () => {
        try {
          await ethersWsProvider.send(METHOD_NAME, params);
          expect(true).to.eq(false);
        } catch (error) {
          expect(error).to.exist;
          expect(error.argument).to.eq('address');
          expect(error.code).to.eq('INVALID_ARGUMENT');
          expect(error.shortMessage).to.eq('invalid address');
        }
      });
    }

    for (const data of VALID_DATA) {
      it(`@release Should execute eth_call on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
        const tx = {
          to: erc20TokenAddr,
          data: data.sighash,
        };

        const output = await ethersWsProvider.send(METHOD_NAME, [tx, 'latest']);
        const outputASCII = erc20EtherInterface.decodeFunctionResult(
          erc20EtherInterface.getFunction(data.sighash)!,
          output,
        );
        expect(outputASCII[0]).to.eq(data.output);
      });
    }
  });
});
