// SPDX-License-Identifier: Apache-2.0

// external resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { numberTo0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import MirrorClient from '@hashgraph/json-rpc-server/tests/clients/mirrorClient';
import RelayClient from '@hashgraph/json-rpc-server/tests/clients/relayClient';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@release @web-socket-batch-2 eth_getTransactionCount', async function () {
  const METHOD_NAME = 'eth_getTransactionCount';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10)));

  // @ts-ignore
  const { mirrorNode, relay }: { mirrorNode: MirrorClient; relay: RelayClient } = global;

  const accounts: AliasAccount[] = [];
  let ethersWsProvider: WebSocketProvider;

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '100000000'; //1 Hbar

    const neededAccounts: number = 2;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialAmount)),
    );
    global.accounts.push(...accounts);

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

  it('should return the transaction count through an ethers WebSocketProvider', async () => {
    const beforeTransactionCountFromWs = await ethersWsProvider.getTransactionCount(accounts[0].address);
    await Utils.sendTransaction(ONE_TINYBAR, CHAIN_ID, accounts, relay, mirrorNode);
    const afterTransactionCountFromWs = await ethersWsProvider.getTransactionCount(accounts[0].address);
    expect(afterTransactionCountFromWs).to.equal(beforeTransactionCountFromWs + 1);
  });

  it('should return the transaction count through a websocket', async () => {
    // get correct gas price for different network environments
    const defaultGasPrice = await relay.gasPrice();

    const beforeSendRawTransactionCountResponse = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [
      accounts[0].address,
      'latest',
    ]);
    WsTestHelper.assertJsonRpcObject(beforeSendRawTransactionCountResponse);
    const transactionCountBefore = await relay.getAccountNonce(accounts[0].address);
    expect(Number(beforeSendRawTransactionCountResponse.result)).to.eq(transactionCountBefore);

    const transaction = {
      value: ONE_TINYBAR,
      gasLimit: numberTo0x(30000),
      chainId: Number(CHAIN_ID),
      to: accounts[1].address,
      maxFeePerGas: defaultGasPrice,
      nonce: await relay.getAccountNonce(accounts[0].address),
    };
    const signedTx = await accounts[0].wallet.signTransaction(transaction);
    // @notice submit a transaction to increase transaction count
    await relay.sendRawTransaction(signedTx);

    const afterSendRawTransactionCountResponse = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [
      accounts[0].address,
      'latest',
    ]);
    WsTestHelper.assertJsonRpcObject(afterSendRawTransactionCountResponse);
    const transactionCountAfter = await relay.getAccountNonce(accounts[0].address);
    expect(Number(afterSendRawTransactionCountResponse.result)).to.eq(transactionCountAfter);
  });
});
