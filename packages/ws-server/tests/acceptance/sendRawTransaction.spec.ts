// SPDX-License-Identifier: Apache-2.0

// external resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined } from '@hashgraph/json-rpc-relay/dist';
import { numberTo0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { ONE_TINYBAR_IN_WEI_HEX } from '@hashgraph/json-rpc-relay/tests/lib/eth/eth-config';
import MirrorClient from '@hashgraph/json-rpc-server/tests/clients/mirrorClient';
import RelayClient from '@hashgraph/json-rpc-server/tests/clients/relayClient';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@web-socket-batch-2 eth_sendRawTransaction', async function () {
  const METHOD_NAME = 'eth_sendRawTransaction';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const INVALID_PARAMS = [
    [],
    [''],
    [66],
    [39],
    [true],
    [false],
    ['abc'],
    ['0xhbar'],
    ['0xHedera'],
    [WsTestConstant.FAKE_TX_HASH, 'hbar'],
    [WsTestConstant.FAKE_TX_HASH, 'rpc', 'invalid'],
  ];

  // @ts-ignore
  const { mirrorNode, relay }: { mirrorNode: MirrorClient; relay: RelayClient } = global;
  const initialBalance = '5000000000'; // 50hbar
  const requestId = 'sendRawTransactionTest_ws-server';
  const requestDetails = new RequestDetails({ requestId: requestId, ipAddress: '0.0.0.0' });

  let tx: any, sendHbarToProxyContractDeployerTx: any, ethersWsProvider: WebSocketProvider;
  const accounts: AliasAccount[] = [];

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];

    const neededAccounts: number = 3;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(
        mirrorNode,
        initialAccount,
        neededAccounts,
        initialBalance,
        requestDetails,
      )),
    );
    global.accounts.push(...accounts);

    tx = {
      value: ONE_TINYBAR_IN_WEI_HEX,
      gasLimit: numberTo0x(30000),
      chainId: Number(CHAIN_ID),
      to: accounts[2].address,
      maxFeePerGas: await relay.gasPrice(requestId),
    };

    sendHbarToProxyContractDeployerTx = {
      value: (10 * 10 ** 18).toString(), // 10hbar - the gasPrice to deploy deterministic proxy contract
      to: constants.DETERMINISTIC_DEPLOYMENT_SIGNER,
      gasPrice: await global.relay.gasPrice(),
      gasLimit: constants.MIN_TX_HOLLOW_ACCOUNT_CREATION_GAS,
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
      it(`Should fail eth_sendRawTransaction on Standard Web Socket and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsStandardWebSocket(METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_sendRawTransaction on Standard Web Socket and handle valid requests correctly`, async () => {
      tx.nonce = await relay.getAccountNonce(accounts[0].address, requestId);
      const signedTx = await accounts[0].wallet.signTransaction(tx);

      const response = await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [signedTx], 1000);
      WsTestHelper.assertJsonRpcObject(response);

      const txHash = response.result;
      const txReceipt = await mirrorNode.get(`/contracts/results/${txHash}`, requestDetails);
      const fromAccountInfo = await mirrorNode.get(`/accounts/${txReceipt.from}`, requestDetails);

      expect(txReceipt.to).to.eq(accounts[2].address.toLowerCase());
      expect(fromAccountInfo.evm_address).to.eq(accounts[0].address.toLowerCase());
    });

    it(`Should fail eth_sendRawTransaction on Standard Web Socket when transaction has invalid format`, async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket(
        METHOD_NAME,
        [constants.INVALID_TRANSACTION],
        1000,
      );

      expect(response.error.code).to.eq(-32000);
      expect(response.error.message).to.contain('unexpected junk after rlp payload');
    });

    it(`Should execute eth_sendRawTransaction on Standard Web Socket for the deterministic deployment transaction`, async () => {
      // send gas money to the proxy deployer
      sendHbarToProxyContractDeployerTx.nonce = await global.relay.getAccountNonce(accounts[0].address);
      const signedSendHbarTx = await accounts[0].wallet.signTransaction(sendHbarToProxyContractDeployerTx);
      await WsTestHelper.sendRequestToStandardWebSocket(METHOD_NAME, [signedSendHbarTx], 1000);
      await new Promise((r) => setTimeout(r, 5000)); // wait for signer's account to propagate accross the network
      const deployerBalance = await global.relay.getBalance(constants.DETERMINISTIC_DEPLOYMENT_SIGNER, 'latest');
      expect(deployerBalance).to.not.eq(0);

      // @logic: since the DETERMINISTIC_DEPLOYER_TRANSACTION is a deterministic transaction hash which is signed
      //          by the DETERMINISTIC_DEPLOYMENT_SIGNER with tx.nonce = 0. With that reason, if the current nonce of the signer
      //          is not 0, it means the DETERMINISTIC_DEPLOYER_TRANSACTION has already been submitted, and the DETERMINISTIC_PROXY_CONTRACT
      //          has already been deployed to the network. Therefore, it only matters to test this flow once.
      const signerNonce = await global.relay.getAccountNonce(constants.DETERMINISTIC_DEPLOYMENT_SIGNER);

      if (signerNonce === 0) {
        // send transaction to deploy proxy transaction
        const deterministicDeploymentTransactionHash = await WsTestHelper.sendRequestToStandardWebSocket(
          METHOD_NAME,
          [constants.DETERMINISTIC_DEPLOYER_TRANSACTION],
          1000,
        );

        const receipt = await global.mirrorNode.get(
          `/contracts/results/${deterministicDeploymentTransactionHash.result}`,
        );
        const fromAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.from}`);
        const toAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.to}`);

        expect(receipt).to.exist;
        expect(fromAccountInfo.evm_address).to.eq(constants.DETERMINISTIC_DEPLOYMENT_SIGNER);
        expect(toAccountInfo.evm_address).to.eq(constants.DETERMINISTIC_PROXY_CONTRACT);
        expect(receipt.address).to.eq(constants.DETERMINISTIC_PROXY_CONTRACT);
      } else {
        const response = await WsTestHelper.sendRequestToStandardWebSocket(
          METHOD_NAME,
          [constants.DETERMINISTIC_DEPLOYER_TRANSACTION],
          1000,
        );
        const expectedNonceTooLowError = predefined.NONCE_TOO_LOW(0, signerNonce);
        expect(response.error.code).to.eq(expectedNonceTooLowError.code);
        expect(response.error.message).to.contain(expectedNonceTooLowError.message);
      }
    });
  });

  describe(WsTestConstant.ETHERS_WS_PROVIDER, () => {
    for (const params of INVALID_PARAMS) {
      it(`Should fail eth_sendRawTransaction on Ethers Web Socket Provider and throw predefined.INVALID_PARAMETERS if the request's params variable is invalid. params=[${params}]`, async () => {
        await WsTestHelper.assertFailInvalidParamsEthersWsProvider(ethersWsProvider, METHOD_NAME, params);
      });
    }

    it(`@release Should execute eth_sendRawTransaction on Ethers Web Socket Provider and handle valid requests correctly`, async () => {
      tx.nonce = await relay.getAccountNonce(accounts[1].address, requestId);
      const signedTx = await accounts[1].wallet.signTransaction(tx); // const signedTx = await accounts[0].wallet.signTransaction(tx);

      const txHash = await ethersWsProvider.send(METHOD_NAME, [signedTx]);

      const txReceipt = await mirrorNode.get(`/contracts/results/${txHash}`, requestDetails);
      const fromAccountInfo = await mirrorNode.get(`/accounts/${txReceipt.from}`, requestDetails);

      expect(txReceipt.to).to.eq(accounts[2].address.toLowerCase());
      expect(fromAccountInfo.evm_address).to.eq(accounts[1].address.toLowerCase());
    });

    it(`Should fail eth_sendRawTransaction on Ethers Web Socket Provider when transaction has invalid format`, async () => {
      try {
        await ethersWsProvider.send(METHOD_NAME, [constants.INVALID_TRANSACTION]);
        expect.fail('Should have thrown an error');
      } catch ({ error }) {
        expect(error.code).to.eq(-32000);
        expect(error.message).to.contain('unexpected junk after rlp payload');
      }
    });

    it(`Should execute eth_sendRawTransaction on Ethers Web Socket Provider for the deterministic deployment transaction`, async () => {
      // send gas money to the proxy deployer
      sendHbarToProxyContractDeployerTx.nonce = await global.relay.getAccountNonce(accounts[1].address);
      const signedSendHbarTx = await accounts[1].wallet.signTransaction(sendHbarToProxyContractDeployerTx);
      await ethersWsProvider.send(METHOD_NAME, [signedSendHbarTx]);
      await new Promise((r) => setTimeout(r, 5000)); // wait for signer's account to propagate accross the network
      const deployerBalance = await global.relay.getBalance(constants.DETERMINISTIC_DEPLOYMENT_SIGNER, 'latest');
      expect(deployerBalance).to.not.eq(0);

      // @logic: since the DETERMINISTIC_DEPLOYER_TRANSACTION is a deterministic transaction hash which is signed
      //          by the DETERMINISTIC_DEPLOYMENT_SIGNER with tx.nonce = 0. With that reason, if the current nonce of the signer
      //          is not 0, it means the DETERMINISTIC_DEPLOYER_TRANSACTION has already been submitted, and the DETERMINISTIC_PROXY_CONTRACT
      //          has already been deployed to the network. Therefore, it only matters to test this flow once.
      const signerNonce = await global.relay.getAccountNonce(constants.DETERMINISTIC_DEPLOYMENT_SIGNER);

      if (signerNonce === 0) {
        // send transaction to deploy proxy transaction
        const deterministicDeploymentTransactionHash = await ethersWsProvider.send(METHOD_NAME, [
          constants.DETERMINISTIC_DEPLOYER_TRANSACTION,
        ]);

        const receipt = await global.mirrorNode.get(`/contracts/results/${deterministicDeploymentTransactionHash}`);
        const fromAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.from}`);
        const toAccountInfo = await global.mirrorNode.get(`/accounts/${receipt.to}`);

        expect(receipt).to.exist;
        expect(fromAccountInfo.evm_address).to.eq(constants.DETERMINISTIC_DEPLOYMENT_SIGNER);
        expect(toAccountInfo.evm_address).to.eq(constants.DETERMINISTIC_PROXY_CONTRACT);
        expect(receipt.address).to.eq(constants.DETERMINISTIC_PROXY_CONTRACT);
      } else {
        try {
          await ethersWsProvider.send(METHOD_NAME, [constants.DETERMINISTIC_DEPLOYER_TRANSACTION]);
        } catch (error) {
          const expectedNonceTooLowError = predefined.NONCE_TOO_LOW(0, signerNonce);
          expect(error.info.error.code).to.eq(expectedNonceTooLowError.code);
          expect(error.info.error.message).to.contain(expectedNonceTooLowError.message);
        }
      }
    });
  });
});
