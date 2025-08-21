// SPDX-License-Identifier: Apache-2.0

// external resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { numberTo0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import { ONE_TINYBAR_IN_WEI_HEX } from '@hashgraph/json-rpc-relay/tests/lib/eth/eth-config';
import MirrorClient from '@hashgraph/json-rpc-server/tests/clients/mirrorClient';
import RelayClient from '@hashgraph/json-rpc-server/tests/clients/relayClient';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-2 eth_getTransactionByHash', async function () {
  const METHOD_NAME = 'eth_getTransactionByHash';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const INVALID_PARAMS = [
    [],
    [''],
    [66],
    [39],
    [true],
    ['abc'],
    ['0xhbar'],
    ['txHash'],
    ['0xHedera'],
    [WsTestConstant.FAKE_TX_HASH, 'hbar'],
    [WsTestConstant.FAKE_TX_HASH, 'rpc', 'invalid'],
  ];

  // @ts-ignore
  const { mirrorNode, relay, initialBalance }: { mirrorNode: MirrorClient; relay: RelayClient } = global;

  const accounts: AliasAccount[] = [];
  let txHash: string, expectedTxReceipt: any, ethersWsProvider: WebSocketProvider;

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];

    const neededAccounts: number = 2;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialBalance)),
    );
    global.accounts.push(...accounts);

    const tx = {
      value: ONE_TINYBAR_IN_WEI_HEX,
      gasLimit: numberTo0x(30000),
      chainId: Number(CHAIN_ID),
      to: accounts[1].address,
      nonce: await relay.getAccountNonce(accounts[0].address),
      maxFeePerGas: await relay.gasPrice(),
    };
    const signedTx = await accounts[0].wallet.signTransaction(tx);
    txHash = await relay.sendRawTransaction(signedTx);
    expectedTxReceipt = await mirrorNode.get(`/contracts/results/${txHash}`);
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
      it(`Should fail eth_getTransactionByHash on Standard Web Socket and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getTransactionByHash on Standard Web Socket and handle valid requests correctly`, async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [txHash]);
      WsTestHelper.assertJsonRpcObject(response);

      const txReceipt = response.result;
      expect(txReceipt.from).to.be.eq(accounts[0].address.toLowerCase());
      expect(txReceipt.to).to.be.eq(accounts[1].address.toLowerCase());
      expect(txReceipt.blockHash).to.be.eq(expectedTxReceipt.block_hash.slice(0, 66));
      expect(txReceipt.hash).to.be.eq(expectedTxReceipt.hash);
      // Must convert to quantity to compare and remove leading zeros
      expect(txReceipt.r).to.be.eq(ethers.toQuantity(expectedTxReceipt.r));
      expect(txReceipt.s).to.be.eq(ethers.toQuantity(expectedTxReceipt.s));
      expect(Number(txReceipt.v)).to.be.eq(expectedTxReceipt.v);
    });
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_getTransactionByHash on Ethers Web Socket Provider and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsEthersWsProvider(ethersWsProvider, METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_getTransactionByHash on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
      const txReceipt = await ethersWsProvider.send(METHOD_NAME, [txHash]);
      expect(txReceipt.from).to.be.eq(accounts[0].address.toLowerCase());
      expect(txReceipt.to).to.be.eq(accounts[1].address.toLowerCase());
      expect(txReceipt.blockHash).to.be.eq(expectedTxReceipt.block_hash.slice(0, 66));
      expect(txReceipt.hash).to.be.eq(expectedTxReceipt.hash);
      // Must convert to quantity to compare and remove leading zeros
      expect(txReceipt.r).to.be.eq(ethers.toQuantity(expectedTxReceipt.r));
      expect(txReceipt.s).to.be.eq(ethers.toQuantity(expectedTxReceipt.s));
      expect(Number(txReceipt.v)).to.be.eq(expectedTxReceipt.v);
    });
  });
});
