// SPDX-License-Identifier: Apache-2.0

// external resources
import basicContractJson from '@hashgraph/json-rpc-server/tests/contracts/Basic.json';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-2 eth_getCode', async function () {
  const METHOD_NAME = 'eth_getCode';

  let basicContract: ethers.Contract,
    basicContractAddress: string,
    codeFromRPC: string,
    ethersWsProvider: WebSocketProvider;

  before(async () => {
    const account: AliasAccount = global.accounts[0];
    basicContract = await Utils.deployContract(basicContractJson.abi, basicContractJson.bytecode, account.wallet);
    basicContractAddress = basicContract.target as string;
    codeFromRPC = (await account.wallet.provider?.getCode(basicContractAddress)) as string;
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

  it('@release should return the code ethers WebSocketProvider', async function () {
    const codeFromWs = await ethersWsProvider.getCode(basicContractAddress);
    expect(codeFromWs).to.be.a('string');
    expect(codeFromRPC).to.equal(codeFromWs);
  });

  it('@release should return the code through a websocket', async () => {
    const param = [basicContractAddress, 'latest'];
    const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, param);
    WsTestHelper.assertJsonRpcObject(response);
    expect(response.result).to.equal(codeFromRPC);
  });
});
