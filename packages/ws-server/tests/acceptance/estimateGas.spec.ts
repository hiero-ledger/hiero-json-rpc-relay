// SPDX-License-Identifier: Apache-2.0

// external resources
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import basicContractJson from '@hashgraph/json-rpc-server/tests/contracts/Basic.json';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-1 eth_estimateGas', async function () {
  const METHOD_NAME = 'eth_estimateGas';
  const PING_CALL_ESTIMATED_GAS = '0x6122';
  const BASIC_CONTRACT_PING_CALL_DATA = '0x5c36b186';

  // @ts-ignore
  const { mirrorNode } = global;
  const accounts: AliasAccount[] = [];
  let basicContract: ethers.Contract,
    currentPrice: number,
    expectedGas: number,
    gasPriceDeviation: number,
    ethersWsProvider: WebSocketProvider;

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '2500000000'; //25 Hbar
    const neededAccounts: number = 1;

    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialAmount)),
    );
    global.accounts.push(...accounts);

    currentPrice = await global.relay.gasPrice();
    expectedGas = parseInt(PING_CALL_ESTIMATED_GAS, 16);

    // handle deviation in gas price of 20%.  On testnet gas price can vary depending on the network congestion
    gasPriceDeviation = parseFloat(expectedGas.toString() ?? '0.2');
  });

  beforeEach(async () => {
    ethersWsProvider = new ethers.WebSocketProvider(WsTestConstant.WS_RELAY_URL);
    basicContract = await Utils.deployContract(basicContractJson.abi, basicContractJson.bytecode, accounts[0].wallet);
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

  it('@release should execute "eth_estimateGas" for contract call, using a websocket provider', async function () {
    const estimatedGas = await ethersWsProvider.estimateGas({
      to: basicContract.target,
      data: BASIC_CONTRACT_PING_CALL_DATA,
    });

    // handle deviation in gas price.  On testnet gas price can vary depending on the network congestion
    expect(Number(estimatedGas)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
    expect(Number(estimatedGas)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
  });

  it('@release should execute "eth_estimateGas" for contract call, using a standard websocket', async () => {
    const tx = { to: basicContract.target, data: BASIC_CONTRACT_PING_CALL_DATA };
    const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [tx]);
    WsTestHelper.assertJsonRpcObject(response);
    expect(Number(response.result)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
    expect(Number(response.result)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
  });
});
